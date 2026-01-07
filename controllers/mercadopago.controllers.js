import fetch from "node-fetch";
import { db } from "../firebaseAdmin.js";

export const webhookMercadoPago = async (req, res) => {
  try {
    const { type, data } = req.body;

    // 🔁 SUSCRIPCIONES
    if (type === "preapproval") {
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

      await db.collection("suscripciones")
        .doc(preapprovalId)
        .update({
          status: sub.status,
          last_update: new Date(),
        });
    }

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
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook MercadoPago error:", error);
    res.sendStatus(500);
  }
};
