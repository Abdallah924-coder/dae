'use strict';

const { z } = require('zod');

const PHONE_RE = /^\+?\d{8,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BINANCE_UID_RE = /^\d{4,32}$/;
const NETWORK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

const orderSchema = z.object({
  mode: z.enum(['buy', 'sell']),
  asset: z.string().trim().min(1),
  amount: z.number().positive(),
  network: z.string().trim().max(40).optional(),
  operator: z.enum(['mtn', 'airtel']),
  phone: z.string().trim().regex(PHONE_RE, 'Numéro de téléphone invalide'),
  recipientName: z.string().trim().max(100).optional(),
  email: z
    .string()
    .trim()
    .max(160)
    .regex(EMAIL_RE, 'Adresse e-mail invalide')
    .optional()
    .or(z.literal('')),
  wallet: z.string().trim().max(7100).optional(),
  proof: z.string().trim().min(6).max(200).optional(),
  proofImage: z.string().max(1600000).optional(),
  cryptoTransferMethod: z.enum(['network', 'binance_pay']).default('network'),
  binancePayId: z.string().trim().regex(BINANCE_UID_RE).optional(),
});

const proofSchema = z.object({
  proof: z.string().trim().min(6).max(200),
  proofImage: z.string().max(1600000),
});

const statusSchema = z.object({
  status: z.string(),
  note: z.string().max(300).optional(),
});

const rateSchema = z
  .object({
    buyRate: z.number().positive(),
    sellRate: z.number().positive(),
    buyMinXaf: z.number().min(0),
    buyMaxXaf: z.number().min(0),
    sellMinXaf: z.number().min(0),
    sellMaxXaf: z.number().min(0),
  })
  .refine((d) => d.buyMinXaf < d.buyMaxXaf, {
    message: 'buyMinXaf doit être inférieur à buyMaxXaf',
    path: ['buyMinXaf'],
  })
  .refine((d) => d.sellMinXaf < d.sellMaxXaf, {
    message: 'sellMinXaf doit être inférieur à sellMaxXaf',
    path: ['sellMinXaf'],
  });

const contactSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().max(160).regex(EMAIL_RE),
  message: z.string().trim().min(1).max(1500),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().max(1024),
});

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Données invalides',
        details: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    req.body = result.data;
    next();
  };
}

module.exports = {
  orderSchema,
  proofSchema,
  statusSchema,
  rateSchema,
  contactSchema,
  loginSchema,
  validate,
  NETWORK_ID_RE,
};
