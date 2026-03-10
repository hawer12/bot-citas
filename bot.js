require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const connectDB = require("./database");
const { SEDES } = require("./sedes");
const {
  agendarCita,
  consultarCitas,
  cancelarCita,
  obtenerDiasDisponibles,
  obtenerHorasDisponibles,
} = require("./citasController");

const token = process.env.BOT_TOKEN;
if (!token) { console.error("No se encontro BOT_TOKEN en .env"); process.exit(1); }

const bot = new TelegramBot(token, { polling: true });
console.log("Bot EPS funcionando...");

const SESION_TTL_MS = 30 * 60 * 1000;

process.on("uncaughtException", (err) => console.error("Error no capturado:", err));
process.on("unhandledRejection", (reason) => console.error("Rechazo no manejado:", reason));

// ===================== SESIONES =====================
async function getSesion(chatId) {
  try {
    const db = await connectDB();
    const sesion = await db.collection("sesiones").findOne({ chatId });
    if (!sesion) return null;
    if (Date.now() - new Date(sesion.updatedAt).getTime() > SESION_TTL_MS) {
      await db.collection("sesiones").deleteOne({ chatId });
      return null;
    }
    return sesion;
  } catch (err) { console.error("Error en getSesion:", err); return null; }
}

async function setSesion(chatId, datos) {
  try {
    const db = await connectDB();
    await db.collection("sesiones").updateOne(
      { chatId },
      { $set: { chatId, ...datos, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (err) { console.error("Error en setSesion:", err); }
}

async function deleteSesion(chatId) {
  try {
    const db = await connectDB();
    await db.collection("sesiones").deleteOne({ chatId });
  } catch (err) { console.error("Error en deleteSesion:", err); }
}

// ===================== MENU =====================
function enviarMenuPrincipal(chatId, nombre) {
  const saludo = nombre ? `Hola *${nombre}*` : "Hola";
  bot.sendMessage(chatId,
    `${saludo}, bienvenido al sistema de citas EPS.\n\nQue deseas hacer?`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📅 Agendar cita",       callback_data: "agendar"   }],
          [{ text: "📄 Consultar mis citas", callback_data: "consultar" }],
          [{ text: "❌ Cancelar una cita",   callback_data: "cancelar"  }],
        ],
      },
    }
  );
}

// ===================== SEDE =====================
function pedirSede(chatId) {
  return bot.sendMessage(chatId, "Selecciona tu sede:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📍 Villa Rica",     callback_data: "sede_villa_rica"    }],
        [{ text: "📍 Puerto Tejada",  callback_data: "sede_puerto_tejada" }],
        [{ text: "📍 Guachene",       callback_data: "sede_guachene"      }],
        [{ text: "🏠 Volver al menu", callback_data: "menu"               }],
      ],
    },
  });
}

// ===================== TIPO DOCUMENTO =====================
function pedirTipoDocumento(chatId) {
  return bot.sendMessage(chatId, "Selecciona el tipo de documento:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Cedula de Ciudadania (CC)", callback_data: "tdoc_CC" }],
        [{ text: "Tarjeta de Identidad (TI)", callback_data: "tdoc_TI" }],
        [{ text: "🏠 Volver al menu",          callback_data: "menu"    }],
      ],
    },
  });
}

// ===================== ESPECIALIDADES =====================
function mostrarEspecialidades(chatId) {
  return bot.sendMessage(chatId, "Selecciona la especialidad:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🩺 Medicina General", callback_data: "esp_medicina"    }],
        [{ text: "🦷 Odontologia",      callback_data: "esp_odontologia" }],
        [{ text: "👶 Pediatria",        callback_data: "esp_pediatria"   }],
        [{ text: "🏠 Volver al menu",   callback_data: "menu"            }],
      ],
    },
  });
}

// ===================== MENSAJES =====================
bot.on("message", async (msg) => {
  try {
    const chatId = msg.chat.id;
    const texto  = msg.text?.trim();
    const nombre = msg.from?.first_name || "";

    if (!texto) return;

    if (["hola", "/start", "menu"].includes(texto.toLowerCase())) {
      await deleteSesion(chatId);
      return enviarMenuPrincipal(chatId, nombre);
    }

    const estado = await getSesion(chatId);
    if (!estado) return;

    if (estado.esperandoDocumento) {
      if (!/^\d{6,12}$/.test(texto)) {
        return bot.sendMessage(chatId, "⚠️ Ingresa solo numeros (6 a 12 digitos):");
      }

      const db = await connectDB();
      const usuario = await db.collection("usuarios").findOne({
        documento: texto,
        tipoDoc: estado.tipoDoc,
      });

      if (!usuario) {
        return bot.sendMessage(chatId,
          `❌ No se encontro un usuario con ${estado.tipoDoc} ${texto}.\nVerifica el tipo y numero de documento.`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: "🏠 Volver al menu", callback_data: "menu" }]],
            },
          }
        );
      }

      const hoy      = new Date();
      const fechaNac = new Date(usuario.fechaNacimiento);
      const edad = hoy.getFullYear() - fechaNac.getFullYear() -
        (hoy < new Date(hoy.getFullYear(), fechaNac.getMonth(), fechaNac.getDate()) ? 1 : 0);

      await setSesion(chatId, {
        ...estado,
        documento:          texto,
        nombreUsuario:      usuario.nombre,
        esMayorDe60:        edad >= 60,
        esperandoDocumento: false,
      });

      await bot.sendMessage(chatId, `Bienvenido ${usuario.nombre}.`);

      const nuevoEstado = await getSesion(chatId);
      if (nuevoEstado.accion === "agendar")   return mostrarEspecialidades(chatId);
      if (nuevoEstado.accion === "consultar") return mostrarCitas(chatId, texto, nuevoEstado.nombreUsuario);
      if (nuevoEstado.accion === "cancelar")  return mostrarCitasParaCancelar(chatId, texto);
    }
  } catch (err) {
    console.error("Error en bot.on('message'):", err);
  }
});

// ===================== CALLBACKS =====================
bot.on("callback_query", async (query) => {
  try {
    const chatId = query.message.chat.id;
    const data   = query.data;
    const nombre = query.from?.first_name || "";

    bot.answerCallbackQuery(query.id);

    // --- Menu ---
    if (data === "menu") {
      await deleteSesion(chatId);
      return enviarMenuPrincipal(chatId, nombre);
    }

    // --- Accion principal → pedir sede primero ---
    if (["agendar", "consultar", "cancelar"].includes(data)) {
      await setSesion(chatId, { accion: data });
      return pedirSede(chatId);
    }

    // --- Sede elegida → pedir tipo documento ---
    if (data.startsWith("sede_")) {
      const sedeKey = data.replace("sede_", "");
      const sede    = SEDES[sedeKey];
      const estado  = await getSesion(chatId);
      if (!estado) return bot.sendMessage(chatId, "Tu sesion expiro. Intenta nuevamente.");

      await setSesion(chatId, { ...estado, sede });
      return pedirTipoDocumento(chatId);
    }

    // --- Tipo de documento ---
    if (data.startsWith("tdoc_")) {
      const tipoDoc = data.replace("tdoc_", "");
      const estado  = await getSesion(chatId);
      if (!estado) return bot.sendMessage(chatId, "Tu sesion expiro. Intenta nuevamente.");

      await setSesion(chatId, { ...estado, tipoDoc, esperandoDocumento: true });
      return bot.sendMessage(chatId, `✍️ Ingresa tu numero de ${tipoDoc}:`, {
        reply_markup: {
          inline_keyboard: [[{ text: "🏠 Volver al menu", callback_data: "menu" }]],
        },
      });
    }

    // --- Especialidad → dias disponibles ---
    if (["esp_medicina", "esp_odontologia", "esp_pediatria"].includes(data)) {
      const mapEsp = {
        esp_medicina:    "medicina_general",
        esp_odontologia: "odontologia",
        esp_pediatria:   "pediatria",
      };
      const estado = await getSesion(chatId);
      if (!estado) return bot.sendMessage(chatId, "Tu sesion expiro. Intenta nuevamente.");

      const especialidad = mapEsp[data];
      await setSesion(chatId, { ...estado, especialidad });

      await bot.sendMessage(chatId, "⏳ Buscando fechas disponibles...");
      const dias = await obtenerDiasDisponibles(especialidad);

      if (!dias.length) {
        return bot.sendMessage(chatId, "❌ No hay fechas disponibles en los proximos 15 dias.", {
          reply_markup: { inline_keyboard: [[{ text: "🏠 Volver al menu", callback_data: "menu" }]] },
        });
      }

      const teclado = dias.map((d) => [{ text: d.label, callback_data: `dia_${d.valor}` }]);
      teclado.push([{ text: "🏠 Volver al menu", callback_data: "menu" }]);

      return bot.sendMessage(chatId, "📅 Selecciona el dia de tu cita:", {
        reply_markup: { inline_keyboard: teclado },
      });
    }

    // --- Dia elegido → horas disponibles ---
    if (data.startsWith("dia_")) {
      const fechaStr = data.replace("dia_", "");
      const estado   = await getSesion(chatId);
      if (!estado) return bot.sendMessage(chatId, "Tu sesion expiro. Intenta nuevamente.");

      await setSesion(chatId, { ...estado, fechaSeleccionada: fechaStr });

      const horas = await obtenerHorasDisponibles(estado.especialidad, fechaStr, estado.esMayorDe60);
      if (!horas.length) {
        return bot.sendMessage(chatId, "❌ No hay horas disponibles para ese dia. Elige otro.", {
          reply_markup: { inline_keyboard: [[{ text: "🏠 Volver al menu", callback_data: "menu" }]] },
        });
      }

      const teclado = horas.map((h) => [{ text: h, callback_data: `hora_${h}` }]);
      teclado.push([{ text: "🏠 Volver al menu", callback_data: "menu" }]);

      return bot.sendMessage(chatId, "⏰ Selecciona tu hora:", {
        reply_markup: { inline_keyboard: teclado },
      });
    }

    // --- Hora elegida → agendar ---
    if (data.startsWith("hora_")) {
      const estado = await getSesion(chatId);
      if (!estado) return bot.sendMessage(chatId, "Tu sesion expiro. Intenta nuevamente.");

      if (!estado.fechaSeleccionada) {
        return bot.sendMessage(chatId, "❌ No se encontro la fecha. Empieza de nuevo.", {
          reply_markup: { inline_keyboard: [[{ text: "🏠 Volver al menu", callback_data: "menu" }]] },
        });
      }

      const resultado = await agendarCita(
        estado.documento,
        estado.tipoDoc,
        estado.sede,
        estado.especialidad,
        estado.fechaSeleccionada,
        data,
        estado.esMayorDe60
      );

      await deleteSesion(chatId);

      if (resultado.error) {
        return bot.sendMessage(chatId, `❌ ${resultado.error}`, {
          reply_markup: { inline_keyboard: [[{ text: "🏠 Volver al menu", callback_data: "menu" }]] },
        });
      }

      return bot.sendMessage(chatId,
        `✅ Cita agendada exitosamente!\n\n` +
        `Paciente: ${estado.nombreUsuario}\n` +
        `Sede: ${resultado.sede}\n` +
        `Especialidad: ${resultado.especialidad}\n` +
        `Doctor: ${resultado.doctor}\n` +
        `Fecha: ${resultado.fecha}\n` +
        `Hora: ${resultado.horario}\n\n` +
        `─────────────────────\n` +
        `Recuerda:\n` +
        `- Lleva tu documento de identidad\n` +
        `- Llega 20 minutos antes de tu cita\n` +
        `- Si no puedes asistir, cancela con anticipacion`,
        {
          reply_markup: { inline_keyboard: [[{ text: "🏠 Volver al menu", callback_data: "menu" }]] },
        }
      );
    } // ← cierre correcto del bloque hora_

    // --- Cancelar cita especifica ---
    if (data.startsWith("cancelar_")) {
      const id    = data.replace("cancelar_", "");
      const exito = await cancelarCita(id);
      return bot.sendMessage(chatId,
        exito ? "✅ Cita cancelada correctamente." : "❌ No se pudo cancelar la cita.",
        {
          reply_markup: { inline_keyboard: [[{ text: "🏠 Volver al menu", callback_data: "menu" }]] },
        }
      );
    }

  } catch (err) {
    console.error("Error en bot.on('callback_query'):", err);
  }
});

// ===================== MOSTRAR CITAS =====================
async function mostrarCitas(chatId, documento, nombreUsuario) {
  const citas = await consultarCitas(documento);

  if (!citas.length) {
    return bot.sendMessage(chatId,
      `${nombreUsuario ? nombreUsuario + ", no" : "No"} tienes citas pendientes.`, {
      reply_markup: { inline_keyboard: [[{ text: "Volver al menu", callback_data: "menu" }]] },
    });
  }

  let mensaje = `${nombreUsuario ? nombreUsuario + ", tus" : "Tus"} citas pendientes:\n\n`;
  citas.forEach((cita, i) => {
    const fecha = new Date(cita.fecha).toLocaleDateString("es-CO");
    mensaje += `${i + 1}. ${cita.especialidad}\nSede: ${cita.sede || "—"}\nFecha: ${fecha}\nHora: ${cita.horario}\nDoctor: ${cita.nombreDoctor}\n\n`;
  });

  bot.sendMessage(chatId, mensaje, {
    reply_markup: { inline_keyboard: [[{ text: "Volver al menu", callback_data: "menu" }]] },
  });
}

// ===================== CANCELAR =====================
async function mostrarCitasParaCancelar(chatId, documento) {
  const citas = await consultarCitas(documento);
  if (!citas.length) {
    return bot.sendMessage(chatId, "No tienes citas activas.", {
      reply_markup: { inline_keyboard: [[{ text: "Volver al menu", callback_data: "menu" }]] },
    });
  }

  const botones = citas.map((cita) => {
    const fecha = new Date(cita.fecha).toLocaleDateString("es-CO");
    const textoBoton = `${cita.especialidad} - ${fecha} ${cita.horario}`.substring(0, 60);
    return [{
      text: textoBoton,
      callback_data: `cancelar_${cita._id}`,
    }];
  });
  botones.push([{ text: "Volver al menu", callback_data: "menu" }]);

  bot.sendMessage(chatId, "Selecciona la cita que deseas cancelar:", {
    reply_markup: { inline_keyboard: botones },
  });
}