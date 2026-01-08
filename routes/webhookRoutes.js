// routes/webhookRoutes.js
const { admin, db } = require("../firebaseAdmin.js");
const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");



router.post("/", async (req, res) => {
  console.log("🌐 WEBHOOK RECIBIDO:", JSON.stringify(req.body, null, 2));
  try {
    const { type, data } = req.body;

    if (type === "payment") {
      const paymentId = data.id;

      // Obtener el pago desde Mercado Pago
      const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
        },
      });

      const payment = await paymentRes.json();

      if (payment.status === "approved") {
        const [cursoId, uid] = payment.external_reference.split("_");

        // Obtener el precio del curso desde Firestore
        const cursoRef = db.collection("cursos_privados").doc(cursoId);
        const cursoSnap = await cursoRef.get();

        if (!cursoSnap.exists) {
          console.warn("⚠️ Curso no encontrado:", cursoId);
          return res.sendStatus(404);
        }

        const cursoData = cursoSnap.data();
        const cursoPrecio = cursoData.precio; // Asegúrate de que el precio esté en el documento

        // Verificar que el monto del pago coincida con el precio del curso
        if (payment.transaction_amount !== cursoPrecio) {
          console.warn("⚠️ Monto del pago no coincide con el precio del curso");
          return res.sendStatus(400); // El monto no coincide
        }

        // 🔓 Actualizar usuario en Firestore
        const userRef = db.collection("users").doc(uid);
        const userSnap = await userRef.get();

        if (!userSnap.exists) {
          console.warn("⚠️ Usuario no encontrado:", uid);
          return res.sendStatus(404);
        }

        // ⬇⬇⬇⬇ Agregar curso a la lista de cursos del usuario
        const userData = userSnap.data();
        const cursosComprados = new Set(userData.cursosComprados || []);
        cursosComprados.add(cursoId);

        await userRef.update({
          cursosComprados: Array.from(cursosComprados),
        });

        // Agregar UID como comprador del curso
        await cursoRef.update({
          compradores: admin.firestore.FieldValue.arrayUnion(uid),
        });

        // ⭐ Emitir notificación via socket.io a TODOS los clientes
        if (req.io) {  // Asegurarse de que io está disponible
          const notifyMessage = {
            message: `✅ ¡Pago aprobado! Acceso al curso activado.`,
            type: "payment_approved",
            courseId: cursoId,
            userId: uid,
            timestamp: new Date().toISOString(),
          };

          console.log(`📢 Broadcasting notify evento:`, notifyMessage);
          req.io.emit('notify', notifyMessage);  // Usamos req.io aquí
        }

        console.log(`✅ Usuario ${uid} habilitado para el curso ${cursoId}`);
      }
    }





    // Manejo de suscripciones
    else if (type === "subscription") {
      const subscriptionStatus = data.status;  // El estado de la suscripción

      const { id, external_reference } = data;
      const uid = external_reference;  // Ahora usamos el UID como referencia externa

      // Obtener la información del usuario
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        console.warn("⚠️ Usuario no encontrado:", uid);
        return res.sendStatus(404);
      }

      const userData = userSnap.data();

      if (subscriptionStatus === "cancelled") {
        // Si la suscripción fue cancelada
        console.log(`⚠️ Suscripción cancelada para el usuario ${uid}`);
        await userRef.update({
          suscripcionActiva: false,
          suscripcionFechaVencimiento: admin.firestore.FieldValue.serverTimestamp(), // Actualizamos la fecha de vencimiento
        });
      }

      if (subscriptionStatus === "rejected") {
        // Si el pago fue rechazado
        console.log(`⚠️ El pago fue rechazado para el usuario ${uid}`);
      }

      if (subscriptionStatus === "active") {
        // Si la suscripción se activa
        console.log(`✅ Suscripción activada para el usuario ${uid}`);
        await userRef.update({
          suscripcionActiva: true,
          suscripcionFechaVencimiento: admin.firestore.FieldValue.serverTimestamp(), // Actualizamos la fecha de vencimiento
        });
      }

      // Emitir notificación sobre el estado de la suscripción
      if (req.io) {
        const notifyMessage = {
          message: `🔔 Estado de suscripción cambiado: ${subscriptionStatus}`,
          type: "subscription_status_changed",
          userId: uid,
          timestamp: new Date().toISOString(),
        };

        console.log(`📢 Broadcasting notify evento:`, notifyMessage);
        req.io.emit('notify', notifyMessage);  // Notificar a todos los clientes
      }
    }







    // MercadoPago ENVÍA "preapproval" para suscripciones
    if (type === "preapproval") {
      const preapprovalId = data.id;

      const resp = await fetch(
        `https://api.mercadopago.com/preapproval/${preapprovalId}`,
        { headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN_SUSCRIPCION}` } }
      );

      const sub = await resp.json();
      const subSnap = await db.collection("suscripciones").doc(preapprovalId).get();

      if (!subSnap.exists) return res.sendStatus(200);

      const { uid } = subSnap.data();
      const estado = sub.status;

      console.log("📡 EVENTO DE SUSCRIPCIÓN:", preapprovalId, estado);

      // 🔻 Cancelaciones y pausas
      if (estado === "cancelled" || estado === "paused") {
        await db.collection("users").doc(uid).update({
          suscripcionActiva: false
        });
      }

      // 🔼 Renovaciones (ciclo)
      if (estado === "active") {
        await db.collection("users").doc(uid).update({
          suscripcionActiva: true,
          suscripcionVencimiento: new Date(new Date().setMonth(new Date().getMonth() + 1))
        });
      }

      return res.sendStatus(200);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Error en webhook de Mercado Pago:", error);
    res.sendStatus(500);
  }
});







module.exports = router;
