const connectDB = require("./database");

// =====================================================
// HORARIOS DISPONIBLES
// =====================================================
const HORARIOS = {};
for (let h = 7; h <= 16; h++) {
  for (let m = 0; m < 60; m += 15) {
    if (h === 16 && m > 30) break;
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    HORARIOS[`hora_${hh}:${mm}`] = `${hh}:${mm}`;
  }
}

// =====================================================
// CACHE DE DOCTORES
// =====================================================
let cacheDoctores = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000;

async function obtenerDoctores(db) {
  const ahora = Date.now();
  if (cacheDoctores && ahora - cacheTimestamp < CACHE_TTL) return cacheDoctores;
  cacheDoctores = await db.collection("doctores").find({}).toArray();
  cacheTimestamp = ahora;
  return cacheDoctores;
}

function normalizar(texto) {
  return texto.toString().toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const ESP_NOMBRE = {
  medicina_general: "Medicina General",
  odontologia: "Odontologia",
  pediatria: "Pediatria",
};

const DIAS_NOMBRE  = ["Dom","Lun","Mar","Mie","Jue","Vie","Sab"];
const MESES_NOMBRE = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// =====================================================
// DIAS DISPONIBLES — proximos 15 dias lun-sab
// Un dia aparece si al menos un doctor tiene menos
// de 24 pacientes ese dia
// =====================================================
async function obtenerDiasDisponibles(especialidad) {
  try {
    const db = await connectDB();
    const listaDoctores = (await obtenerDoctores(db)).filter(
      (d) => normalizar(d.especialidad) === normalizar(especialidad)
    );
    if (!listaDoctores.length) return [];

    const dias = [];
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    for (let i = 1; i <= 15; i++) {
      const fecha = new Date(hoy);
      fecha.setDate(hoy.getDate() + i);
      const diaSemana = fecha.getDay();
      if (diaSemana === 0) continue;

      const inicioDia = new Date(fecha); inicioDia.setHours(0, 0, 0, 0);
      const finDia    = new Date(fecha); finDia.setHours(23, 59, 59, 999);

      let hayDisponibilidad = false;
      for (const doctor of listaDoctores) {
        const count = await db.collection("citas").countDocuments({
          doctorId: doctor._id,
          fecha: { $gte: inicioDia, $lte: finDia },
          estado: { $ne: "cancelada" },
        });
        // FIX: limite real es 24 pacientes por dia
        if (count < 24) { hayDisponibilidad = true; break; }
      }

      if (hayDisponibilidad) {
        dias.push({
          label: `${DIAS_NOMBRE[diaSemana]} ${fecha.getDate()} ${MESES_NOMBRE[fecha.getMonth()]}`,
          valor: fecha.toISOString().split("T")[0],
        });
      }
    }
    return dias;
  } catch (err) {
    console.error("Error en obtenerDiasDisponibles:", err);
    return [];
  }
}

// =====================================================
// HORAS DISPONIBLES DE UN DIA
// Un slot desaparece cuando TODOS los doctores ya
// tienen una cita en ese horario exacto ese dia
// =====================================================
async function obtenerHorasDisponibles(especialidad, fechaStr, esMayorDe60) {
  try {
    const db = await connectDB();
    const listaDoctores = (await obtenerDoctores(db)).filter(
      (d) => normalizar(d.especialidad) === normalizar(especialidad)
    );
    if (!listaDoctores.length) return [];

    const fecha    = new Date(fechaStr + "T00:00:00");
    const esSabado = fecha.getDay() === 6;
    if (esSabado && !esMayorDe60) return [];

    const inicioDia = new Date(fecha); inicioDia.setHours(0, 0, 0, 0);
    const finDia    = new Date(fecha); finDia.setHours(23, 59, 59, 999);

    // Traer citas del dia con horario Y doctorId
    const citasDelDia = await db.collection("citas").find(
      { fecha: { $gte: inicioDia, $lte: finDia }, estado: { $ne: "cancelada" } },
      { projection: { horario: 1, doctorId: 1 } }
    ).toArray();

    // Por cada slot saber que doctores ya tienen cita ahi
    const ocupadosPorSlot = {};
    citasDelDia.forEach((c) => {
      if (!ocupadosPorSlot[c.horario]) ocupadosPorSlot[c.horario] = new Set();
      ocupadosPorSlot[c.horario].add(c.doctorId.toString());
    });

    // Tambien contar cuantas citas tiene cada doctor hoy en total
    const citasPorDoctor = {};
    citasDelDia.forEach((c) => {
      const id = c.doctorId.toString();
      citasPorDoctor[id] = (citasPorDoctor[id] || 0) + 1;
    });

    const totalDoctores = listaDoctores.length;

    let horaInicio, horaFin, minFin;
    if (esMayorDe60) {
      horaInicio = 7; horaFin = esSabado ? 11 : 12; minFin = esSabado ? 45 : 30;
    } else {
      horaInicio = 13; horaFin = 16; minFin = 30;
    }

    const resultado = [];
    for (let h = horaInicio; h <= horaFin; h++) {
      for (let m = 0; m < 60; m += 15) {
        if (h === horaFin && m > minFin) break;
        const texto = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;

        // Contar doctores disponibles para este slot:
        // disponible = no tiene cita en ese slot Y no llego a 24 pacientes hoy
        let doctoresDisponiblesEnSlot = 0;
        for (const doctor of listaDoctores) {
          const docId          = doctor._id.toString();
          const tieneEseSlot   = ocupadosPorSlot[texto]?.has(docId) || false;
          const llego24        = (citasPorDoctor[docId] || 0) >= 24;
          if (!tieneEseSlot && !llego24) doctoresDisponiblesEnSlot++;
        }

        // El slot aparece si al menos un doctor esta disponible
        if (doctoresDisponiblesEnSlot > 0) resultado.push(texto);
      }
    }
    return resultado;
  } catch (err) {
    console.error("Error en obtenerHorasDisponibles:", err);
    return [];
  }
}

// =====================================================
// AGENDAR CITA
// Asigna el doctor que:
// A) No tenga cita en ese slot exacto ese dia
// B) No haya llegado a 24 pacientes en el dia
// =====================================================
async function agendarCita(userId, tipoDoc, sede, especialidad, fechaStr, slotHora, esMayorDe60) {
  try {
    const db = await connectDB();
    const citas = db.collection("citas");

    // 1. Restriccion 15 dias por especialidad
    const hace15Dias = new Date();
    hace15Dias.setDate(hace15Dias.getDate() - 15);
    const citasRecientes = await citas.find(
      { userId, fecha: { $gte: hace15Dias }, estado: { $ne: "cancelada" } },
      { projection: { especialidad: 1, fecha: 1 } }
    ).toArray();

    const citaReciente = citasRecientes.find(
      (c) => normalizar(c.especialidad) === normalizar(especialidad)
    );
    if (citaReciente) {
      const fCita  = new Date(citaReciente.fecha);
      const fHabil = new Date(citaReciente.fecha);
      fHabil.setDate(fHabil.getDate() + 15);
      return {
        error: `Ya tienes una cita de ${ESP_NOMBRE[especialidad] || especialidad} para el ${fCita.toLocaleDateString("es-CO")}. Podras agendar desde el ${fHabil.toLocaleDateString("es-CO")}.`,
      };
    }

    // 2. Parsear hora del slot "hora_09:00" → 9, 0
    const slotLimpio = slotHora.replace("hora_", "");
    const [horaStr, minStr] = slotLimpio.split(":");
    const horaNum = parseInt(horaStr, 10);
    const minNum  = parseInt(minStr || "0", 10);
    if (isNaN(horaNum) || isNaN(minNum)) return { error: "Horario invalido." };

    // 3. Doctores de la especialidad
    const listaDoctores = (await obtenerDoctores(db)).filter(
      (d) => normalizar(d.especialidad) === normalizar(especialidad)
    );
    if (!listaDoctores.length) return { error: "No hay doctores disponibles para esa especialidad." };

    // 4. Construir fechas
    const fechaBase    = new Date(fechaStr + "T00:00:00");
    const fechaCita    = new Date(fechaBase);
    fechaCita.setHours(horaNum, minNum, 0, 0);
    const inicioDia    = new Date(fechaBase); inicioDia.setHours(0, 0, 0, 0);
    const finDia       = new Date(fechaBase); finDia.setHours(23, 59, 59, 999);
    const horarioTexto = HORARIOS[slotHora] || slotLimpio;

    // 5. Buscar doctor disponible para ese slot
    for (const doctor of listaDoctores) {

      // Condicion A — ese doctor ya tiene ese slot ocupado hoy?
      const citaEnEseSlot = await citas.findOne({
        doctorId: doctor._id,
        horario:  horarioTexto,
        fecha:    { $gte: inicioDia, $lte: finDia },
        estado:   { $ne: "cancelada" },
      });
      if (citaEnEseSlot) continue;

      // Condicion B — ese doctor ya llego a 24 pacientes hoy?
      const totalDelDia = await citas.countDocuments({
        doctorId: doctor._id,
        fecha:    { $gte: inicioDia, $lte: finDia },
        estado:   { $ne: "cancelada" },
      });
      if (totalDelDia >= 24) continue;

      // Doctor disponible — guardar cita
      const result = await citas.insertOne({
        userId,
        tipoDoc,
        sede,
        doctorId:     doctor._id,
        nombreDoctor: doctor.nombre.trim(),
        especialidad,
        horario:      horarioTexto,
        fecha:        fechaCita,
        fechaDia:     inicioDia,
        esMayorDe60:  esMayorDe60 || false,
        estado:       "activa",
        creadaEn:     new Date(),
      });

      return {
        success:      true,
        citaId:       result.insertedId,
        sede,
        doctor:       doctor.nombre.trim(),
        especialidad: ESP_NOMBRE[especialidad] || especialidad,
        horario:      horarioTexto,
        fecha:        fechaCita.toLocaleDateString("es-CO"),
      };
    }

    return { error: "Ese horario ya no esta disponible. Por favor selecciona otro." };

  } catch (err) {
    console.error("Error en agendarCita:", err);
    return { error: "Error interno al agendar. Intenta nuevamente." };
  }
}

// =====================================================
// CONSULTAR CITAS — desde medianoche de hoy
// =====================================================
async function consultarCitas(userId) {
  try {
    const db = await connectDB();
    const inicioDiaHoy = new Date();
    inicioDiaHoy.setHours(0, 0, 0, 0);
    return await db.collection("citas")
      .find(
        { userId, estado: "activa", fecha: { $gte: inicioDiaHoy } },
        { projection: { nombreDoctor: 1, especialidad: 1, horario: 1, fecha: 1, sede: 1, _id: 1 } }
      )
      .sort({ fecha: 1 })
      .limit(5)
      .toArray();
  } catch (err) {
    console.error("Error en consultarCitas:", err);
    return [];
  }
}

// =====================================================
// CANCELAR CITA
// =====================================================
async function cancelarCita(citaId) {
  try {
    const db = await connectDB();
    const { ObjectId } = require("mongodb");
    const result = await db.collection("citas").updateOne(
      { _id: new ObjectId(citaId) },
      { $set: { estado: "cancelada", canceladaEn: new Date() } }
    );
    return result.modifiedCount > 0;
  } catch (err) {
    console.error("Error en cancelarCita:", err);
    return false;
  }
}

module.exports = {
  agendarCita,
  consultarCitas,
  cancelarCita,
  obtenerDiasDisponibles,
  obtenerHorasDisponibles,
  HORARIOS,
};