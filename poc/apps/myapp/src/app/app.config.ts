import { ApplicationConfig } from '@angular/core';
import {
  provideConnectAngular,
  provideCustomTriggers,
} from '@poc/connect-angular';
import type { CustomTrigger } from '@poc/connect-angular';
import { provideHashbrown } from '@hashbrownai/angular';
import { environment } from '../environments/environment';

// -- Sample custom triggers -----------------------------------------------
// Replace with your real internal business events.
const customTriggers: CustomTrigger[] = [
  {
    id: 'order.created',
    name: 'Order Created',
    description: 'Fires when a new customer order is placed in the system.',
    icon: '\u{1F6D2}',
    payloadSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'Unique order identifier' },
        customerId: { type: 'string', description: 'Customer identifier' },
        totalAmount: { type: 'number', description: 'Order total in cents' },
        currency: { type: 'string', description: 'ISO 4217 currency code' },
        items: {
          type: 'array',
          description: 'Line items',
          items: {
            type: 'object',
            properties: {
              productId: { type: 'string' },
              quantity: { type: 'number' },
            },
          },
        },
      },
      required: ['orderId', 'customerId', 'totalAmount'],
    },
  },
  {
    id: 'user.signup',
    name: 'User Signed Up',
    description: 'Fires when a new user completes registration.',
    icon: '\u{1F464}',
    payloadSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string' },
        plan: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
      },
      required: ['userId', 'email'],
    },
  },
  {
    id: 'payment.failed',
    name: 'Payment Failed',
    description: 'Fires when a payment attempt is declined.',
    icon: '\u{1F4B3}',
    payloadSchema: {
      type: 'object',
      properties: {
        paymentId: { type: 'string' },
        customerId: { type: 'string' },
        amount: { type: 'number' },
        reason: { type: 'string' },
      },
      required: ['paymentId', 'customerId'],
    },
  },
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideConnectAngular({
      tokenEndpointUrl: `${environment.apiUrl}/api/pipedream/token`,
      // In a real app this comes from auth -- hardcoded here for demo
      externalUserId: 'demo-user-1',
    }),
    provideCustomTriggers(customTriggers),
    provideHashbrown({ baseUrl: `${environment.apiUrl}/api/chat` }),
  ],
};
