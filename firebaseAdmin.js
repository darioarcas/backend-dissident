// backend/firebaseAdmin.js

const admin = require('firebase-admin');
let serviceAccount;


if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    // Parsear el JSON guardado como variable de entorno
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (error) {
    console.error("❌ Error al parsear FIREBASE_SERVICE_ACCOUNT:", error);
    throw new Error('Error al parsear FIREBASE_SERVICE_ACCOUNT');
  }
} else {
  // En producción, debería estar configurada en las variables de entorno
  throw new Error('FIREBASE_SERVICE_ACCOUNT no está definido en las variables de entorno');
}

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log('Firebase Admin inicializado correctamente.'); // Confirmamos que se inicializa
} catch (error) {
  console.error("❌ Error al inicializar Firebase Admin:", error);  // Si hay un error, lo reportamos
  throw error;  // Lanzamos el error si la inicialización falla
}

const db = admin.firestore();

module.exports = { admin, db };



