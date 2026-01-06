// backend/services/mercadoPagoService.js
const admin = require('firebase-admin'); // Usamos Firebase Admin para acceder a Firestore
const fetch = require('node-fetch');

// Verificamos si Firebase está inicializado antes de acceder a Firestore
if (admin.apps.length === 0) {
  console.log("❌ Firebase no ha sido inicializado correctamente antes de este punto");
} else {
  console.log("✅ Firebase ya está inicializado");
}


const db = admin.firestore();  // Acceso a Firestore 


const crearPreferenciaPago = async ({ cursoNombre, cursoId, uid, base_url }) => {
  // Validar que base_url sea una URL permitida
  const allowedOrigins = ['https://dissidentsschool.com', 'https://darioarcas.github.io', 'http://localhost:3000'];
  if (!allowedOrigins.includes(base_url)) {
    throw new Error('Origen no permitido');
  }
  if (base_url === 'https://darioarcas.github.io' || base_url === 'http://localhost:3000') {
    base_url += '/dissidents-web/#';
  }

  // Obtener el precio del curso desde Firestore
  try {
    const cursoRef = db.doc(`cursos_privados/${cursoId}`);  
    const cursoDoc = await cursoRef.get();

    if (!cursoDoc.exists) {
      throw new Error('Curso no encontrado');
    }

    const cursoData = cursoDoc.data();
    const precio = cursoData.precio;

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
      notification_url: `https://backend-dissident.onrender.com/api/webhook/mercadopago`,  // URL del webhook para notificaciones
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







// Crear una suscripción
const crearSuscripcion = async ({ uid, base_url }) => {
  const allowedOrigins = ['https://dissidentsschool.com', 'https://darioarcas.github.io', 'http://localhost:3000'];
  if (!allowedOrigins.includes(base_url)) {
    throw new Error('Origen no permitido');
  }

  if (base_url === 'https://darioarcas.github.io' || base_url === 'http://localhost:3000') {
    base_url += '/dissidents-web/#';
  }

  try {
    // Obtener el precio de la suscripción desde Firestore
    const cursoRef = db.doc(`cursos_privados/suscription`);  
    const cursoDoc = await cursoRef.get();

    if (!cursoDoc.exists) {
      throw new Error('Suscripción no encontrada');
    }

    const cursoData = cursoDoc.data();
    const precio = cursoData.precio;  // Suponiendo que el campo "precio" está en el curso

    // Crear la preferencia de suscripción sin asociarla a un curso
    const successUrl = `${base_url}/perfil`;
    const failureUrl = `${base_url}/error-pago`;

    // Configuración de la suscripción
    const preference = {
      items: [
        {
          title: 'Suscripción mensual a los servicios de Dissidents School',  // Título genérico para la suscripción
          quantity: 1,
          unit_price: precio,  // Precio dinámico
          currency_id: 'ARS',
        },
      ],
      back_urls: {
        success: successUrl,
        failure: failureUrl,
      },
      notification_url: `https://backend-dissident.onrender.com/api/webhook/mercadopago`,  // URL del webhook
      external_reference: uid,  // Aquí usamos el UID del usuario como referencia externa
      auto_return: 'approved',
      subscription: {
        frequency: 1,  // Frecuencia mensual
        frequency_type: 'months',
        transaction_amount: precio,  // Valor mensual de la suscripción
        currency_id: 'ARS',
        back_urls: {
          success: successUrl,
          failure: failureUrl,
        },
      },
    };

    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preference),
    });

    const data = await response.json();
    console.log("✅ Preferencia de suscripción creada:", data);
    return data.init_point;  // Retorna el punto de inicio para redirigir al usuario
  } catch (error) {
    console.error('❌ Error creando preferencia de suscripción:', error);
    throw error;
  }
};



module.exports = { crearPreferenciaPago, crearSuscripcion };
