import { Router } from 'express';
import {
  attributeSchema,
  listQuerySchema,
  paymentTermSchema,
  productSchema,
  taxSchema,
} from '@brightloop/shared';
import { adminOnly } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { catalogController as c } from './catalog.controller';

/** Back office reads; only the admin changes the catalog. */
export const catalogRoutes = Router()
  .get('/taxes', c.listTaxes)
  .post('/taxes', adminOnly, validate(taxSchema), c.createTax)
  .put('/taxes/:id', adminOnly, validate(taxSchema), c.updateTax)
  .get('/payment-terms', c.listPaymentTerms)
  .post('/payment-terms', adminOnly, validate(paymentTermSchema), c.createPaymentTerm)
  .get('/attributes', c.listAttributes)
  .post('/attributes', adminOnly, validate(attributeSchema), c.createAttribute)
  .put('/attributes/:id', adminOnly, validate(attributeSchema), c.updateAttribute)
  .get('/products', validate(listQuerySchema.passthrough(), 'query'), c.listProducts)
  .get('/products/:id', c.getProduct)
  .post('/products', adminOnly, validate(productSchema), c.createProduct)
  .put('/products/:id', adminOnly, validate(productSchema), c.updateProduct);
