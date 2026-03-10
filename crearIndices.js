// PROTECCION — solo crea indices, nunca borra datos
const colecciones = await db.listCollections().toArray();
const nombres = colecciones.map(c => c.name);

if (nombres.includes("usuarios")) {
  const count = await db.collection("usuarios").countDocuments();
  console.log(`Coleccion usuarios tiene ${count} documentos — NO se toca`);
} else {
  console.log("Coleccion usuarios no existe — se creara al insertar datos");
}
require("dotenv").config();
const connectDB = require("./database");

async function crearIndices() {
  const db = await connectDB();

  console.log("⏳ Creando índices...");

  // Índices colección CITAS
  await db.collection("citas").createIndex({ userId: 1, fecha: -1 });
  await db.collection("citas").createIndex({ doctorId: 1, fecha: 1 });
  await db.collection("citas").createIndex({ estado: 1 });
  await db.collection("citas").createIndex({ userId: 1, estado: 1, fecha: 1 });

  // Índices colección SESIONES
  await db.collection("sesiones").createIndex({ chatId: 1 }, { unique: true });
  await db.collection("sesiones").createIndex(
    { updatedAt: 1 },
    { expireAfterSeconds: 1800 }
  );

  // Índices colección DOCTORES
  await db.collection("doctores").createIndex({ especialidad: 1 });

  // Índices colección USUARIOS
  await db.collection("usuarios").createIndex({ documento: 1 }, { unique: true });

  console.log("✅ Índices creados correctamente");
  process.exit(0);
}

crearIndices().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});