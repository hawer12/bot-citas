require("dotenv").config();

const express = require("express");
const axios = require("axios");
const connectDB = require("./database");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = "eps_token_123";
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

let db;

// =============================
// 🔹 CONECTAR A MONGODB
// =============================
connectDB()
  .then(database => {
    db = database;
    console.log("✅ Base de datos lista");
  })
  .catch(err => {
    console.error("❌ Error conectando a MongoDB:", err);
  });

// =============================
// 🔹 ENDPOINT DE PRUEBA (FORZAR CREACIÓN DB)
// =============================
app.get("/crear-prueba", async (req, res) => {
  try {
    if (!db) {
      return res.status(500).send("Base de datos no conectada");
    }

    await db.collection("mensajes").insertOne({
      numero: "123456",
      mensaje: "Prueba manual desde navegador",
      fecha: new Date(),
    });

    res.send("✅ Documento creado en MongoDB");
  } catch (error) {
    console.error("Error insertando:", error);
    res.status(500).send("Error");
  }
});

// =============================
// 🔹 VERIFICACIÓN DEL WEBHOOK
// =============================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// =============================
// 🔹 RECIBIR MENSAJES WHATSAPP
// =============================
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object) {
      const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

      if (message) {
        const from = message.from;
        const userMessage = message.text?.body;

        console.log("📩 Mensaje recibido:", userMessage);

        // 🔥 Guardar mensaje en MongoDB
        if (db) {
          await db.collection("mensajes").insertOne({
            numero: from,
            mensaje: userMessage,
            fecha: new Date(),
          });
        }

        // 🔥 Responder en WhatsApp
        await axios.post(
          `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: from,
            text: { body: "👋 Hola, bienvenido al sistema de citas EPS." },
          },
          {
            headers: {
              Authorization: `Bearer ${ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
      }

      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error("❌ Error en webhook:", error.response?.data || error);
    res.sendStatus(500);
  }
});

// =============================
// 🔹 INICIAR SERVIDOR
// =============================
app.listen(3000, () => {
  console.log("🚀 Servidor corriendo en puerto 3000");
});