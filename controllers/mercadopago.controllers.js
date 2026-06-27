// controllers/mercadopago.controllers.js

import fetch from "node-fetch";
import { db } from "../firebaseAdmin.js";

export const webhookMercadoPago = async (req, res) => {
  try {
    const { type, data } = req.body;

    if (!data || !data.id) {
      return res.sendStatus(400); // Bad request si Mercado Pago envía algo vacío
    }

    // 💰 MANEJO DE PAGOS ÚNICOS O CUOTAS DE SUSCRIPCIÓN
    if (type === "payment") {
      const paymentId = data.id;

      const mpRes = await fetch(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN_SUSCRIPCION}`,
          },
        }
      );

      const payment = await mpRes.json();

      if (payment.status === "approved") {
        // Asegurar que metadata exista antes de destructurar
        const { uid, cursoId, tipo } = payment.metadata || {};

        if (uid && cursoId) {
          // CORREGIDO: "users" en vez de "usuarios" para mantener consistencia
          await db.collection("users")
            .doc(uid)
            .collection("cursosComprados")
            .doc(cursoId)
            .set({
              activo: true,
              tipo: tipo || "curso",
              pagoId: paymentId,
              fecha: new Date(),
            });
        }

        // Si el pago proviene de una suscripción automática
        if (payment.preapproval_id) {
          const preId = payment.preapproval_id;
          const subDoc = await db.collection("suscripciones").doc(preId).get();

          if (!subDoc.exists) {
            console.warn("Suscripción no encontrada en Firestore:", preId);
            return res.sendStatus(200); 
          }

          const subData = subDoc.data();
          const finalUid = uid || subData.uid; // fallback por si no vino en metadata

          await db.collection("users").doc(finalUid).update({
            suscripcionActiva: true,
            suscripcionFechaInicio: new Date(),
            suscripcionVencimiento: new Date(new Date().setMonth(new Date().getMonth() + 1)),
          });

          console.log("🔥 SUSCRIPCIÓN ACTIVADA POR COBRO DE PAGO PARA UID:", finalUid);
        }
      }
      
      return res.sendStatus(200); // Respondemos 200 siempre a MP para congelar el webhook
    }

    // 🔁 MANEJO DE CAMBIOS EN EL ESTADO DE LA SUSCRIPCIÓN (Alta, Pausa, Cancelación)
    if (type === "preapproval") {
      console.log("Webhook de suscripción recibido");
      const preapprovalId = data.id;

      const mpRes = await fetch(
        `https://api.mercadopago.com/preapproval/${preapprovalId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN_SUSCRIPCION}`,
          },
        }
      );

      const sub = await mpRes.json();
      const { uid, cursoId } = sub.metadata || {};

      // Actualizar estado histórico en la colección suscripciones
      await db.collection("suscripciones").doc(preapprovalId).update({
        status: sub.status,
        updatedAt: new Date(),
      });

      if (!uid) {
        console.warn("⚠️ No se pudo procesar el estado de suscripción porque falta el UID en la metadata.");
        return res.sendStatus(200);
      }

      // *** ACTIVAR SUSCRIPCIÓN ***
      if (sub.status === "authorized") {
        console.log("✅ Suscripción Autorizada/Activada:", uid, cursoId);
        
        // CORREGIDO: Se removió 'admin.firestore' que causaba crash y se usa Date estándar compatible con Firestore
        await db.collection("users").doc(uid).update({
          suscripcionActiva: true,
          suscripcionFechaInicio: new Date(),
          suscripcionVencimiento: new Date(new Date().setMonth(new Date().getMonth() + 1)),
        });

        if (req.io) {
          req.io.emit(
            "notify",
            JSON.stringify({
              type: "subscription_activated",
              uid,
              cursoId,
              status: sub.status,
              at: new Date().toISOString(),
            })
          );
        }
      }

      // *** DESACTIVAR SUSCRIPCIÓN ***
      if (["cancelled", "paused", "expired"].includes(sub.status)) {
        console.log(`❌ Suscripción fuera de servicio (${sub.status}):`, uid, cursoId);
        
        await db.collection("users").doc(uid).update({
          suscripcionActiva: false,
        });

        if (req.io) {
          req.io.emit(
            "notify",
            JSON.stringify({
              type: "subscription_cancelled",
              uid,
              cursoId,
              status: sub.status,
              at: new Date().toISOString(),
            })
          );
        }
      }

      return res.sendStatus(200);
    }

    // Si llega un evento que no nos interesa (ej. "plan" o "invoice") devolvemos 200 igual
    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook MercadoPago error:", error);
    res.sendStatus(500); // MP reintentará el envío más tarde al recibir un 500
  }
};