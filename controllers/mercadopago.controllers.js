// controllers/mercadopago.controllers.js

import fetch from "node-fetch";
import { db } from "../firebaseAdmin.js";

export const webhookMercadoPago = async (req, res) => {
  try {
    const { type, data } = req.body;

    // 🔁 SUSCRIPCIONES
    // if (type === "preapproval") {
    //   const preapprovalId = data.id;

    //   const mpRes = await fetch(
    //     `https://api.mercadopago.com/preapproval/${preapprovalId}`,
    //     {
    //       headers: {
    //         Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN_SUSCRIPCION}`,
    //       },
    //     }
    //   );

    //   const sub = await mpRes.json();

    //   await db.collection("suscripciones")
    //     .doc(preapprovalId)
    //     .update({
    //       status: sub.status,
    //       last_update: new Date(),
    //     });
    // }

    // 💰 PAGOS
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
        const { uid, cursoId, tipo } = payment.metadata;

        await db.collection("usuarios")
          .doc(uid)
          .collection("cursos")
          .doc(cursoId)
          .set({
            activo: true,
            tipo,
            pagoId: paymentId,
            fecha: new Date(),
          });


        // si es una suscripción, activar suscripción
        if (payment.preapproval_id) {
          // obtener datos de la suscripción
            const preId = payment.preapproval_id;
            const subDoc = await db.collection("suscripciones").doc(preId).get();

            if (!subDoc.exists) {
              console.warn("Suscripción no encontrada en Firestore:", preId);
              return res.sendStatus(200);
            }

            const { uid } = subDoc.data();

            // activar suscripción
            await db.collection("users").doc(uid).update({
              suscripcionActiva: true,
              suscripcionFechaInicio: new Date(),
              suscripcionVencimiento: new Date(new Date().setMonth(new Date().getMonth() + 1)),
            });

            console.log("🔥 SUSCRIPCIÓN ACTIVADA PARA UID:", uid);

            return res.sendStatus(200);
        }
      }
    }



    // 🔁 SUSCRIPCIONES
    if (type === "preapproval") {
      console.log("Webhook de suscripción recibido");
      const preapprovalId = data.id;

      // Obtengo datos actualizados (MP manda un ID, no toda la suscripción)
      const mpRes = await fetch(
        `https://api.mercadopago.com/preapproval/${preapprovalId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN_SUSCRIPCION}`,
          },
        }
      );

      const sub = await mpRes.json();

      // extraigo metadata
      const { uid, cursoId } = sub.metadata || {};

      // actualizo estado en Firestore
      await db.collection("suscripciones").doc(preapprovalId).update({
        status: sub.status,
        updatedAt: new Date(),
      });

      // *** ACTIVAR SUSCRIPCIÓN ***
      if (sub.status === "authorized") {
        console.log("✅ Suscripcion Activada:", uid, cursoId);
        await db.collection("users").doc(uid).update({
          suscripcionActiva: true,
          suscripcionFechaInicio: new Date(),
          suscripcionVencimiento: admin.firestore.Timestamp.fromMillis(
            new Date().setMonth(new Date().getMonth() + 1)
          ),
        });

        // notificación opcional por socket
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
      if (sub.status === "cancelled" || sub.status === "paused" || sub.status === "expired") {
        console.log("❌ Suscripcion Cancelada:", uid, cursoId);
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


    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook MercadoPago error:", error);
    res.sendStatus(500);
  }
};
