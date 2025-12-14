// backend/services/mercadoPagoService.js
const admin = require('firebase-admin'); // Usamos Firebase Admin para acceder a Firestore
const fetch = require('node-fetch');

// Verificamos si Firebase está inicializado antes de acceder a Firestore
if (admin.apps.length === 0) {
  console.log("❌ Firebase no ha sido inicializado correctamente antes de este punto");
} else {
  console.log("✅ Firebase ya está inicializado");
}


const db = admin.firestore();  // Acceso a Firestore (<-------------ACA FALLA)


const crearPreferenciaPago = async ({ cursoNombre, cursoId, uid, base_url }) => {
  // Validar que base_url sea una URL permitida
  const allowedOrigins = ['https://academiagroove.com', 'https://darioarcas.github.io', 'http://localhost:3000'];
  if (!allowedOrigins.includes(base_url)) {
    throw new Error('Origen no permitido');
  }
  if (base_url === 'https://darioarcas.github.io' || base_url === 'http://localhost:3000') {
    base_url += '/pagina-groove-inicio-de-sesion/#';
  }

  // Obtener el precio del curso desde Firestore
  try {
    const cursoRef = db.doc(`cursos_privados/${cursoId}`);  
    const cursoDoc = await cursoRef.get();

    if (!cursoDoc.exists) {
      throw new Error('Curso no encontrado');
    }

    const cursoData = cursoDoc.data();
    const precio = cursoData.precio;  // Suponiendo que el campo "precio" está en el curso

    const successUrl = `${base_url}/perfil`;
    const failureUrl = `${base_url}/error-pago`;

    // Creamos la preferencia de pago
    const preference = {
      items: [
        {
          title: cursoNombre || 'Curso',  // Título del curso, o 'Curso' por defecto
          quantity: 1,
          unit_price: precio,  // Usamos el precio del curso obtenido desde Firestore
          currency_id: 'ARS',
        },
      ],
      back_urls: {
        success: successUrl,
        failure: failureUrl,
      },
      notification_url: `https://backend-groove-pi69.onrender.com/api/webhook/mercadopago`,  // URL del webhook para notificaciones
      external_reference: `${cursoId}_${uid}`,  // Identificador único para la transacción
      auto_return: 'approved',
    };

    // Realizamos la petición POST a MercadoPago para crear la preferencia
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,  // Token de MercadoPago
      },
      body: JSON.stringify(preference),
    });

    const data = await response.json();
    console.log("✅ Preferencia creada:", data);
    return data.init_point;  // Retornamos el punto de inicio para redirigir al usuario
  } catch (error) {
    console.error('❌ Error creando preferencia vía REST:', error);
    throw error;  // Lanza el error para que el controlador lo maneje
  }
};

module.exports = { crearPreferenciaPago };
