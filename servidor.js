require("dotenv").config();
const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const ExcelJS  = require("exceljs");
const connectDB = require("./database");

const app  = express();
const PORT = process.env.PANEL_PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// =====================================================
// GET /api/doctores
// =====================================================
app.get("/api/doctores", async (req, res) => {
  try {
    const db = await connectDB();
    const doctores = await db.collection("doctores")
      .find({}, { projection: { nombre: 1, especialidad: 1 } })
      .toArray();
    res.json(doctores);
  } catch (err) {
    console.error("Error en /api/doctores:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

// =====================================================
// GET /api/citas
// =====================================================
app.get("/api/citas", async (req, res) => {
  try {
    const db    = await connectDB();
    const query = {};

    if (req.query.sede)         query.sede         = req.query.sede;
    if (req.query.especialidad) query.especialidad = req.query.especialidad;
    if (req.query.doctor)       query.nombreDoctor = req.query.doctor;
    if (req.query.fecha) {
      const inicio = new Date(req.query.fecha + "T00:00:00");
      const fin    = new Date(req.query.fecha + "T23:59:59");
      query.fecha  = { $gte: inicio, $lte: fin };
    }

    const citas = await db.collection("citas")
      .find(query)
      .sort({ fecha: 1 })
      .toArray();

    const hoy    = new Date(); hoy.setHours(0,0,0,0);
    const manana = new Date(hoy); manana.setDate(hoy.getDate() + 1);

    const total      = citas.length;
    const citasHoy   = citas.filter(c => new Date(c.fecha) >= hoy && new Date(c.fecha) < manana).length;
    const mayores    = citas.filter(c => c.esMayorDe60).length;
    const canceladas = citas.filter(c => c.estado === "cancelada").length;

    res.json({ citas, total, hoy: citasHoy, mayores, canceladas });
  } catch (err) {
    console.error("Error en /api/citas:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

// =====================================================
// GET /api/exportar
// =====================================================
app.get("/api/exportar", async (req, res) => {
  try {
    const db = await connectDB();

    const filtro = { estado: "activa" };
    if (req.query.doctor)       filtro.nombreDoctor = req.query.doctor;
    if (req.query.sede)         filtro.sede         = req.query.sede;
    if (req.query.especialidad) filtro.especialidad = req.query.especialidad;
    if (req.query.fecha) {
      const inicio = new Date(req.query.fecha + "T00:00:00");
      const fin    = new Date(req.query.fecha + "T23:59:59");
      filtro.fecha = { $gte: inicio, $lte: fin };
    }

    const citas = await db.collection("citas").find(filtro).sort({ fecha: 1 }).toArray();

    const workbook = new ExcelJS.Workbook();
    let tituloHoja = "Citas EPS";
    if (req.query.doctor) tituloHoja = req.query.doctor.substring(0, 31);
    const hoja = workbook.addWorksheet(tituloHoja);

    hoja.columns = [
      { header: "N",            key: "num",          width: 5  },
      { header: "Sede",         key: "sede",          width: 16 },
      { header: "Tipo Doc",     key: "tipoDoc",       width: 10 },
      { header: "Documento",    key: "userId",        width: 15 },
      { header: "Especialidad", key: "especialidad",  width: 20 },
      { header: "Doctor",       key: "doctor",        width: 25 },
      { header: "Fecha",        key: "fecha",         width: 14 },
      { header: "Hora",         key: "horario",       width: 10 },
      { header: "Adulto Mayor", key: "esMayorDe60",   width: 14 },
      { header: "Estado",       key: "estado",        width: 12 },
      { header: "Agendada el",  key: "creadaEn",      width: 22 },
    ];

    // Fila de titulo si hay filtros
    if (req.query.doctor || req.query.fecha) {
      hoja.spliceRows(1, 0, []);
      let textoTitulo = "Reporte de Citas EPS";
      if (req.query.doctor) textoTitulo += "  —  " + req.query.doctor;
      if (req.query.fecha)  textoTitulo += "  —  " + new Date(req.query.fecha + "T12:00:00").toLocaleDateString("es-CO");
      const celdaTitulo = hoja.getRow(1).getCell(1);
      celdaTitulo.value = textoTitulo;
      celdaTitulo.font  = { bold: true, size: 13, color: { argb: "FF0A6E4F" } };
      hoja.mergeCells(1, 1, 1, 11);
      hoja.getRow(1).height = 28;
      hoja.spliceRows(2, 0, []);
    }

    const filaCab = req.query.doctor || req.query.fecha ? 3 : 1;
    hoja.getRow(filaCab).eachCell((cell) => {
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A6E4F" } };
      cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    hoja.getRow(filaCab).height = 22;

    const ESP = { medicina_general:"Medicina General", odontologia:"Odontologia", pediatria:"Pediatria" };

    citas.forEach((c, i) => {
      const fila = hoja.addRow({
        num:          i + 1,
        sede:         c.sede || "—",
        tipoDoc:      c.tipoDoc || "CC",
        userId:       c.userId,
        especialidad: ESP[c.especialidad] || c.especialidad,
        doctor:       c.nombreDoctor,
        fecha:        new Date(c.fecha).toLocaleDateString("es-CO"),
        horario:      c.horario,
        esMayorDe60:  c.esMayorDe60 ? "SI" : "NO",
        estado:       c.estado,
        creadaEn:     new Date(c.creadaEn).toLocaleString("es-CO"),
      });
      const color = i % 2 === 0 ? "FFE6F7F2" : "FFFFFFFF";
      fila.eachCell((cell) => {
        cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });
    });

    const ft = hoja.addRow({
      especialidad: `TOTAL: ${citas.length} citas`,
      esMayorDe60:  `Mayores: ${citas.filter(c => c.esMayorDe60).length}`,
    });
    ft.eachCell((cell) => {
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A6E4F" } };
      cell.font      = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });

    const fechaArchivo = new Date().toISOString().split("T")[0];
    let nombreArchivo  = `citas_eps_${fechaArchivo}`;
    if (req.query.doctor) nombreArchivo = `citas_${req.query.doctor.replace(/ /g,"_")}_${fechaArchivo}`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${nombreArchivo}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error exportando:", err);
    res.status(500).json({ error: "Error al exportar" });
  }
});

app.listen(PORT, () => {
  console.log(`Panel EPS corriendo en http://localhost:${PORT}`);
  console.log(`Abre en: http://localhost:${PORT}/panel.html`);
});