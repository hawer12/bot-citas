const { MongoClient } = require("mongodb");

const uri = process.env.MONGO_URI;

if (!uri) {
  console.error("❌ No se encontró MONGO_URI en el archivo .env");
  process.exit(1);
}

const client = new MongoClient(uri, {
  tls: true,
  tlsAllowInvalidCertificates: true,
  serverSelectionTimeoutMS: 10000,
  maxPoolSize: 50,        // hasta 50 conexiones simultáneas
  minPoolSize: 5,         // mantiene 5 conexiones abiertas siempre
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
});

let db;

async function connectDB() {
  try {
    if (!db) {
      await client.connect();
      console.log("✅ Conectado a MongoDB Atlas");
      db = client.db("epsbot");
    }
    return db;
  } catch (error) {
    console.error("❌ Error conectando a MongoDB:", error);
    process.exit(1);
  }
}

module.exports = connectDB;