'use strict';

const { logger } = require('../middleware/logger');
const { buildSchema } = require('graphql');

const typeDefs = `
  type InventoryEvent {
    id: ID!
    lotCode: String
    itemId: Int
    lotOpId: String
    quantity: Float
    uom: String
    locationId: Int
    timestamp: String
  }

  type SalesEvent {
    id: ID!
    invoiceNo: String
    customerName: String
    totalAmount: Float
    status: String
    timestamp: String
  }

  type PurchaseEvent {
    id: ID!
    billNo: String
    vendorName: String
    totalAmount: Float
    status: String
    timestamp: String
  }

  type JournalEvent {
    id: ID!
    entryNo: String
    totalAmount: Float
    status: String
    type: String
    timestamp: String
  }

  type DashboardEvent {
    metric: String
    value: Float
    change: Float
    period: String
    timestamp: String
  }

  type NotificationEvent {
    id: ID!
    title: String
    message: String
    type: String
    priority: String
    read: Boolean
    timestamp: String
  }

  type PresenceEvent {
    userIds: [Int]
    count: Int
  }

  type Subscription {
    revenueUpdated: DashboardEvent
    expensesUpdated: DashboardEvent
    netProfitUpdated: DashboardEvent
    inventoryCreated: InventoryEvent
    inventoryUpdated: InventoryEvent
    inventoryDeleted: InventoryEvent
    inventoryStockChanged: InventoryEvent
    saleCreated: SalesEvent
    saleUpdated: SalesEvent
    purchaseCreated: PurchaseEvent
    purchaseUpdated: PurchaseEvent
    journalPosted: JournalEvent
    dashboardRefreshed: DashboardEvent
    notificationReceived: NotificationEvent
    presenceUpdated: PresenceEvent
  }

  type Query {
    _health: String
  }

  type Mutation {
    _ping: String
  }

  schema {
    query: Query
    mutation: Mutation
    subscription: Subscription
  }
`;

const resolvers = {
  Subscription: {
    revenueUpdated:      { subscribe: () => {} },
    expensesUpdated:     { subscribe: () => {} },
    netProfitUpdated:    { subscribe: () => {} },
    inventoryCreated:    { subscribe: () => {} },
    inventoryUpdated:    { subscribe: () => {} },
    inventoryDeleted:    { subscribe: () => {} },
    inventoryStockChanged: { subscribe: () => {} },
    saleCreated:         { subscribe: () => {} },
    saleUpdated:         { subscribe: () => {} },
    purchaseCreated:     { subscribe: () => {} },
    purchaseUpdated:     { subscribe: () => {} },
    journalPosted:       { subscribe: () => {} },
    dashboardRefreshed:  { subscribe: () => {} },
    notificationReceived: { subscribe: () => {} },
    presenceUpdated:     { subscribe: () => {} },
  },
};

let schema = null;

function createSchema() {
  if (schema) return schema;
  try {
    require.resolve('graphql');
    schema = buildSchema(typeDefs);
    logger.info('[GraphQL] Schema created');
    return schema;
  } catch (err) {
    logger.info('[GraphQL] graphql package not available; subscriptions via Socket.IO only');
    return null;
  }
}

module.exports = { createSchema, typeDefs, resolvers };
