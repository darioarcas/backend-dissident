// backend/routes/paymentRoutes.js
// import fetch from "node-fetch";
const fetch = require('node-fetch');
const { webhookMercadoPago } = require( "../controllers/mercadopago.controllers.js");
const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { crearPreferenciaPago, crearSuscripcion } = require('../services/mercadoPagoService.js');
// const { crearSuscripcion } = require('../services/mercadoPagoService.js');
const db = admin.firestore();

// Ruta para crear la preferencia de pago
router.post('/create_preference', async (req, res) => {
  console.log("📥 Llamada recibida en /create_preference");


  
  try {
    const { cursoNombre, cursoId, uid, base_url } = req.body;

    // 1. Obtener el precio del curso desde Firestore
    const cursoRef = db.collection('cursos_privados').doc(cursoId);
    const cursoDoc = await cursoRef.get();
    console.log("🔍 Curso obtenido de Firestore:", cursoDoc);

    if (!cursoDoc.exists) {
      return res.status(404).json({ error: 'Curso no encontrado', cursoDoc });
    }

    const cursoData = cursoDoc.data();
    const precio = cursoData.precio;

    // 2. Crear la preferencia de pago con MercadoPago
    const init_point = await crearPreferenciaPago({ 
      cursoNombre, 
      cursoId, 
      uid, 
      precio,
      base_url 
    });

    console.log("🔁 init_point generado:", init_point);

    // 3. Emitir notificación a todos los clientes conectados
    if (req.io) {
      const payload = {
        type: 'preference_created',
        cursoNombre,
        cursoId,
        init_point,
        createdAt: new Date().toISOString()
      };
      req.io.emit('notify', JSON.stringify(payload));
      console.log('[notify] preference_created emitted:', payload);
    } else {
      console.warn('[notify] req.io not available — no emit on preference creation');
    }

    // 4. Responder al cliente (una sola vez)
    return res.status(201).json({ init_point, cursoNombre });
  } catch (error) {
    console.error("❌ Error en /create_preference:", error);
    return res.status(500).json({ error: 'Error creando preferencia' });
  }
});



// Ruta para manejar el webhook de MercadoPago
router.post("/webhook", webhookMercadoPago);






// Ruta para crear una suscripción
router.post("/api/create_subscription", async (req, res) => {
  try {
    const { cursoNombre, cursoId, uid, base_url, email } = req.body;

    // Obtener el precio de la suscripción desde Firestore
    const cursoRef = db.doc(`cursos_privados/suscription`);  
    const cursoDoc = await cursoRef.get();

    if (!cursoDoc.exists) {
      throw new Error('Suscripción no encontrada');
    }

    const cursoData = cursoDoc.data();
    const precio = cursoData.precio;  // Precio de la suscripción

    const response = await fetch(
      "https://api.mercadopago.com/preapproval",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN_SUSCRIPCION}`,
        },
        body: JSON.stringify({
          reason: `Suscripción ${cursoNombre}`,
          back_url: `${base_url}/suscripcion-estado`,
          payer_email: email, // USUARIO REAL
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: precio,
            currency_id: "ARS",
          },
          metadata: {
            uid,
            cursoId,
            tipo: "suscripcion"
          },
          status: "pending"
        }),
      }
    );

    const data = await response.json();

    // 🔐 Guardamos suscripción en estado pendiente
    await db.collection("suscripciones").doc(data.id).set({
      uid,
      cursoId,
      status: data.status,
      createdAt: new Date(),
    });

    res.json({ init_point: data.init_point });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error creando suscripción" });
  }
});




// Ruta para crear una suscripción
// router.post('/create_subscription', async (req, res) => {
//   console.log("📥 Llamada recibida en /create_subscription");

//   try {
//     const { uid, base_url } = req.body;

//     // Crear la suscripción en MercadoPago
//     const init_point = await crearSuscripcion({
//       uid,
//       base_url
//     });

//     console.log("🔁 init_point generado:", init_point);

//     // Activamos la suscripción en la base de datos
//     const userRef = db.collection("users").doc(uid);
//     await userRef.update({
//       suscripcionActiva: true,  // Activamos el campo de suscripción
//       suscripcionFechaInicio: admin.firestore.FieldValue.serverTimestamp(),
//       suscripcionFechaVencimiento: admin.firestore.FieldValue.serverTimestamp(),
//     });

//     // Emitir notificación a todos los clientes conectados (opcional)
//     if (req.io) {
//       const payload = {
//         type: 'subscription_created',
//         uid,
//         init_point,
//         createdAt: new Date().toISOString()
//       };
//       req.io.emit('notify', JSON.stringify(payload));
//       console.log('[notify] subscription_created emitted:', payload);
//     } else {
//       console.warn('[notify] req.io not available — no emit on subscription creation');
//     }

//     return res.status(201).json({ init_point });
//   } catch (error) {
//     console.error("❌ Error en /create_subscription:", error);
//     return res.status(500).json({ error: 'Error creando suscripción' });
//   }
// });


module.exports = router;