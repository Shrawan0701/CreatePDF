import { LANGUAGE_NAMES } from '../shared/languages.js';
const string = { type: 'string' };
const integer = { type: 'integer' };
const numberOrNull = { type: ['number', 'null'] };
const stringOrNull = { type: ['string', 'null'] };
const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items) => ({ type: 'array', items });
export const AI_SCHEMAS = {
  translate: object({ blocks: array(object({ id: string, text: string })) }),
  summarize: object({ text: string }),
  evidence: object({ matches: array(object({ id: string, quote: string, relevance: integer })) }),
  chat: object({ answer: string, language: { type: 'string', enum: LANGUAGE_NAMES }, supported: { type: 'boolean' }, sources: array(object({ page: integer, quote: string })) }),
  invoice: object({ supplierName: stringOrNull, supplierAddress: stringOrNull, invoiceNumber: stringOrNull, invoiceDate: stringOrNull, gstin: stringOrNull, currency: stringOrNull,
    items: array(object({ description: string, quantity: numberOrNull, price: numberOrNull, discount: numberOrNull, amount: numberOrNull })),
    discount: numberOrNull, cgst: numberOrNull, sgst: numberOrNull, igst: numberOrNull, subtotal: numberOrNull, grandTotal: numberOrNull }),
};
