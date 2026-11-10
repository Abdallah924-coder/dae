'use strict';

const EmailOutbox = require('../models/EmailOutbox');
const { logger } = require('../lib/logger');
const { sendEmail } = require('./email');

async function enqueueEmail({ dedupeKey, to, subject, text, html }, { session } = {}) {
  const normalizedTo = String(to || '').trim().toLowerCase();
  if (!normalizedTo || !subject || !text || !html) {
    throw new TypeError('Une notification e-mail doit contenir un destinataire et un contenu complet.');
  }
  try {
    const [message] = await EmailOutbox.create([{
      dedupeKey,
      to: normalizedTo,
      subject,
      text,
      html,
    }], session ? { session } : undefined);
    return message;
  } catch (error) {
    if (error.code !== 11000) throw error;
    if (session) throw error;
    const existing = await EmailOutbox.findOne({ dedupeKey }).session(session || null);
    if (!existing) throw error;
    return existing;
  }
}

let draining = false;

async function drainEmailOutbox({ limit = 10, now = new Date() } = {}) {
  if (draining) return;
  draining = true;
  try {
    for (let index = 0; index < limit; index += 1) {
      const message = await EmailOutbox.findOneAndUpdate(
        {
          $or: [
            { status: 'pending', nextAttemptAt: { $lte: now } },
            { status: 'sending', lockedAt: { $lte: new Date(now.getTime() - 120_000) } },
          ],
        },
        { $set: { status: 'sending', lockedAt: now }, $inc: { attempts: 1 } },
        { sort: { nextAttemptAt: 1, createdAt: 1 }, returnDocument: 'after' },
      );
      if (!message) break;
      try {
        await sendEmail({
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        await EmailOutbox.updateOne({ _id: message._id, status: 'sending' }, {
          $set: { status: 'sent', sentAt: new Date(), lockedAt: null, lastError: null },
        });
      } catch (error) {
        const delayMs = Math.min(60 * 60_000, 5_000 * (2 ** Math.min(message.attempts, 9)));
        await EmailOutbox.updateOne({ _id: message._id, status: 'sending' }, {
          $set: {
            status: 'pending',
            lockedAt: null,
            nextAttemptAt: new Date(Date.now() + delayMs),
            lastError: String(error.message || error).slice(0, 500),
          },
        });
        logger.error({ outboxId: String(message._id), attempts: message.attempts, err: error }, 'Envoi de notification e-mail échoué; nouvelle tentative planifiée');
      }
    }
  } finally {
    draining = false;
  }
}

module.exports = { drainEmailOutbox, enqueueEmail };
