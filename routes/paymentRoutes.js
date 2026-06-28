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



    // 3. Emitir notificación a todos los clientes conectados y alertar por Telegram
    if (req.io) {
      const payload = {
        type: 'preference_created',
        cursoNombre: 'Suscripción Dissidents School',
        cursoId,
        init_point,
        createdAt: new Date().toISOString()
      };
      // Tu lógica original intacta:
      req.io.emit('notify', JSON.stringify(payload));
      console.log('[notify] preference_created emitted:', payload);

      // --- Agregado: Alerta paralela a Telegram ---
      if (req.bot || typeof bot !== 'undefined') {
        const telegramBot = req.bot || bot;
        
        const mensajeTelegram = `🔔 **¡Nueva Preferencia Creada - Dissidents Web!**\n\n` +
                                `📖 *Curso:* ${cursoNombre}\n` +
                                `🆔 *ID Curso:* \`${cursoId}\`\n` +
                                `🔗 [Enlace de Inscripción](${init_point})`;

        const destinoId = typeof ADMIN_CHAT_ID !== 'undefined' ? ADMIN_CHAT_ID : "6689736321";

        telegramBot.telegram.sendMessage(destinoId, mensajeTelegram, { parse_mode: 'Markdown' })
          .then(() => console.log('[Telegram] Alerta enviada con éxito.'))
          .catch(err => console.error('[Telegram] Error al enviar:', err.message));

        console.log("📢 [notify] Alerta de Telegram enviada:", mensajeTelegram);
      }
      // --------------------------------------------

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
// Es una ruta pasiva que Mercado Pago invoca automáticamente de forma asíncrona
// para avisarle a tu servidor cuando un pago fue aprobado, rechazado o está pendiente. 
// Delega toda la lógica a un controlador externo llamado webhookMercadoPago
router.post("/webhook", webhookMercadoPago);









// Ruta para consultar/activar suscripción
router.get("/subscription/:preapprovalId/verify", async (req, res) => {
  try {
    const { preapprovalId } = req.params;

    const resp = await fetch(
      `https://api.mercadopago.com/preapproval/${preapprovalId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN_SUSCRIPCION}`,
          "Content-Type": "application/json"
        }
      }
    );

    const sub = await resp.json();

    console.log("🔍 Estado de suscripción consultado:", sub.status);

    // EXTRAER UID DESDE METADATA (esto viene del create_subscription)
    let uid = sub?.metadata?.uid || null;

    // fallback si viene sin metadata
    if (!uid) {
      const snap = await db.collection("suscripciones").doc(preapprovalId).get();
      if (snap.exists) {
          uid = snap.data()?.uid;
      }
    }

    if (!uid) {
      return res.json({
        status: sub.status,
        activated: false,
        reason: "sin_metadata_uid",
        raw: sub
      });
    }

    // 👉 ACTIVAR AUTOMÁTICAMENTE SI AUTORIZADA
    if (sub.status === "authorized") {

      // Activar suscripción en Firestore
      await db.collection("suscripciones").doc(preapprovalId).update({
        status: sub.status,
        updatedAt: new Date()
      });

      // Activar SUSCRIPCIÓN en usuario
      await db.collection("users").doc(uid).update({
        status: sub.status,
        suscripcionActiva: true,
        suscripcionId: preapprovalId,
        suscripcionFechaInicio: new Date(),
        suscripcionVencimiento: new Date(new Date().setMonth(new Date().getMonth() + 1))
      });


      console.log(`🔥 SUSCRIPCIÓN ACTIVADA PARA UID: ${uid}`);

      return res.json({
        status: sub.status,
        activated: true,
        uid,
        raw: sub
      });
    }

    // Caso suscripción cancelada / pausada
    if (["cancelled", "paused", "expired"].includes(sub.status)) {
      await db.collection("users").doc(uid).update({
        suscripcionActiva: false
      });

      console.log(`🛑 SUSCRIPCIÓN DESACTIVADA PARA UID: ${uid}`);

      return res.json({
        status: sub.status,
        activated: false,
        reason: "cancelled",
        uid,
        raw: sub
      });
    }

    // Caso normal sin cambios
    return res.json({
      status: sub.status,
      activated: false,
      raw: sub
    });

  } catch (error) {
    console.error("Error consultando estado de suscripción:", error);
    res.sendStatus(500);
  }
});







// Ruta para crear una suscripción
router.post("/create_subscription", async (req, res) => {
  try {
    const { cursoNombre, cursoId, uid, base_url: originalBaseUrl, email } = req.body;
    let base_url = originalBaseUrl;

    // Ajustar base_url para GitHub Pages o localhost
    if (base_url === 'https://darioarcas.github.io' || base_url === 'http://localhost:3000') {
      base_url = `${base_url}/dissidents-web/#`;
    }


    // Obtener el precio de la suscripción desde Firestore
    const cursoRef = db.doc(`cursos_privados/suscription`);  
    const cursoDoc = await cursoRef.get();

    if (!cursoDoc.exists) {
      throw new Error('Suscripción no encontrada');
    }









    // Emitir notificación a todos los clientes conectados (opcional)
    // if (req.io) {
    //   const payload = {
    //     type: 'subscription_created',
    //     uid,
    //     // init_point,
    //     createdAt: new Date().toISOString()
    //   };
    //   req.io.emit('notify', JSON.stringify(payload));
    //   console.log('[notify] subscription_created emitted:', payload);


    //   // --- Agregado: Alerta paralela a Telegram ---

    //   console.log('req.bot  ---------------------> ', req.bot);
    //   if (req.bot || typeof bot !== 'undefined') {
    //     const telegramBot = req.bot || bot;
        
    //     const mensajeTelegram = `🔔 **¡Nueva Preferencia Creada - Dissidents Web!**\n\n` +
    //                             `📖 *Curso:* ${cursoNombre}\n` +
    //                             `🆔 *ID Curso:* \`${cursoId}\`\n` +
    //                             `🔗 [Enlace de Inscripción](${init_point})`;

    //     const destinoId = typeof ADMIN_CHAT_ID !== 'undefined' ? ADMIN_CHAT_ID : "6689736321";

    //     telegramBot.telegram.sendMessage(destinoId, mensajeTelegram, { parse_mode: 'Markdown' })
    //       .then(() => console.log('[Telegram] Alerta enviada con éxito.'))
    //       .catch(err => console.error('[Telegram] Error al enviar:', err.message));

    //     console.log("📢 [notify] Alerta de Telegram enviada:", mensajeTelegram);
    //   }
    //   // -----------------------------------------------------
    // } else {
    //   console.warn('[notify] req.io not available — no emit on subscription creation');
    // }









    // 3. Emitir notificación a todos los clientes conectados (RENDER)
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

      // ===================================================================
      // ENVÍO DIRECTO DESDE RENDER A TELEGRAM (Vía API HTTP)
      // ===================================================================
      const TELEGRAM_TOKEN = "8748621456:AAGO14bhq5OxswhU1-XYc_dmDFYT0vwYD5o"; // Tu token
      const ADMIN_CHAT_ID = "6689736321"; // <--- Poné acá tu chat_id numérico real

      const mensajeTelegram = `🔔 **¡Nueva Preferencia Creada!**\n\n` +
                              `📖 *Curso:* ${cursoNombre}\n` +
                              `🆔 *ID Curso:* ${cursoId}\n` +
                              `🔗 [Enlace de Inscripción](${init_point})`;

      // Render le pega directamente a los servidores de Telegram de forma asíncrona
      fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: ADMIN_CHAT_ID,
          text: mensajeTelegram,
          parse_mode: 'Markdown'
        })
      })
      .then(() => console.log('[Telegram] Alerta enviada con éxito desde Render.'))
      .catch(err => console.error('[Telegram] Error al enviar desde Render:', err.message));
      // ===================================================================

    } else {
      console.warn('[notify] req.io not available — no emit on preference creation');
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


    // Validar que se haya creado la suscripción correctamente
    if (!data.id) {
      console.error("❌ Preapproval sin ID:", data);
      return res.status(500).json({ error: "No se pudo crear la suscripción" });
    }



    // Marcar en el usuario status pendiente
    await db.collection("users").doc(uid).update({
      status: data.status,
    });

    console.log("ESTADO DE SUSCRIPCION: ", data.status);



    // 🔥 ACTIVACIÓN INMEDIATA 
    if (data.status === "authorized") {
      await db.collection("users").doc(uid).update({
        suscripcionActiva: true,
        suscripcionFechaInicio: new Date(),
        suscripcionVencimiento: new Date(new Date().setMonth(new Date().getMonth() + 1)),
        suscripcionId: data.id
      });

      console.log("🔥 SUSCRIPCIÓN ACTIVADA INMEDIATA PARA UID:", uid);
    }



    // Validar email
    if (!email) {
      console.error("❌ El email es requerido para suscripciones");
      return res.status(400).json({ error: "Falta email" });
    }




    // 🔐 Guardamos suscripción en estado pendiente
    await db.collection("suscripciones").doc(data.id).set({
      uid,
      cursoId,
      status: data.status,
      createdAt: new Date(),
      nameBody: req.body.name || 'Sin Nombre',
      email: email,
      tipo: "suscripcion"
    });


    res.json({
      init_point: data.init_point,
      preapproval_id: data.id
    });


  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error creando suscripción" });
  }
});









// CANCELAR SUSCRIPCIÓN desde FrontEnd
router.post("/subscription/:preapprovalId/cancel", async (req, res) => {
  try {
    const { preapprovalId } = req.params;

    const resp = await fetch(
      `https://api.mercadopago.com/preapproval/${preapprovalId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN_SUSCRIPCION}`
        },
        body: JSON.stringify({
          status: "cancelled"
        })
      }
    );

    const data = await resp.json();
    console.log("🔻 Cancelación MercadoPago:", data);

    // Extraer UID desde Firestore (si lo guardaste)
    const subDoc = await db.collection("suscripciones").doc(preapprovalId).get();
    const subData = subDoc.data();

    if (subData?.uid) {
      await db.collection("users").doc(subData.uid).update({
        suscripcionActiva: false,
        suscripcionId: null
      });
    }

    await db.collection("suscripciones").doc(preapprovalId).update({
      status: "cancelled",
      updatedAt: new Date()
    });

    return res.json({
      cancelled: true,
      raw: data
    });

  } catch (err) {
    console.error("❌ Error cancelando suscripción:", err);
    res.status(500).json({ cancelled: false, error: "cancel_error" });
  }
});



module.exports = router;