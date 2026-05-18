import {
  BALANCES,
  FILLS,
  ORDERBOOKS,
  ORDERS,
  type CreateOrderInput,
  type Fill,
  type OrderRecord,
  type RestingOrder,
} from '../store/exchange-store';

export function createOrder(input: CreateOrderInput): OrderRecord {
  const { userId, type, side, symbol, price, qty } = input;

  if (!ORDERBOOKS.has(symbol)) {
    ORDERBOOKS.set(symbol, { bids: new Map(), asks: new Map() });
  }
  const book: any = ORDERBOOKS.get(symbol);

  if (!BALANCES.has(userId)) {
    BALANCES.set(userId, {
      USD: { available: 100000, locked: 0 },
      [symbol]: { available: 1000, locked: 0 },
    });
  }
  const userBalance: any = BALANCES.get(userId)!;

  if (side === 'buy') {
    if (type === 'limit') {
      const cost = price! * qty;
      if (userBalance['USD']?.available < cost) {
        throw new Error('insufficient balance');
      }

      userBalance['USD'].available -= cost;
      userBalance['USD'].locked += cost;
    }
  } else {
    if (userBalance[symbol].available < qty) {
      throw new Error('insufficient quantity');
    }
    userBalance[symbol].available -= qty;
    userBalance[symbol].locked += qty;
  }

  const orderId = crypto.randomUUID();

  const order: OrderRecord = {
    orderId,
    userId,
    type,
    side,
    symbol,
    price,
    qty,
    filledQty: 0,
    status: 'open',
    fills: [],
    createdAt: Date.now(),
  };

  ORDERS.set(orderId, order);

  const oppositeSide = side === 'buy' ? book.asks : book.bids;
  const priceLevels = [...oppositeSide.keys()].sort(
    side === 'buy' ? (a, b) => a - b : (a, b) => b - a,
  );

  for (const levelPrice of priceLevels) {
    if (type === 'limit') {
      if (side === 'buy' && levelPrice > price!) break;
      if (side === 'sell' && levelPrice < price!) break;
    }

    const restingOrders = oppositeSide.get(levelPrice);

    while (restingOrders.length > 0 && order.filledQty < order.qty) {
      const resting = restingOrders[0];
      const remainingIncoming = order.qty - order.filledQty;
      const remainingResting = resting.qty - resting.filledQty;
      const fillQty = Math.min(remainingIncoming, remainingResting);
      const fillPrice = levelPrice;

      const fill: Fill = {
        fillId: crypto.randomUUID(),
        symbol,
        price: fillPrice,
        qty: fillQty,
        buyOrderId: side === 'buy' ? orderId : resting.orderId,
        sellOrderId: side === 'sell' ? orderId : resting.orderId,
        createdAt: Date.now(),
      };

      FILLS.push(fill);
      order.fills.push(fill);

      order.filledQty += fillQty;
      resting.filledQty += fillQty;

      resting.status =
        resting.filledQty >= resting.qty ? 'filled' : 'partially_filled';
      if (resting.status === 'filled') restingOrders.shift();

      const restingUser: any = BALANCES.get(resting.userId)!;
      const usdCost = fillQty * fillPrice;

      if (side === 'buy') {
        userBalance['USD'].locked -= usdCost;
        userBalance[symbol] ??= { available: 0, locked: 0 };
        userBalance[symbol].available += fillQty;

        restingUser['USD'] ??= { available: 0, locked: 0 };
        restingUser['USD'].available += usdCost;
        restingUser[symbol].locked -= fillQty;
      } else {
        userBalance['USD'] ??= { available: 0, locked: 0 };
        userBalance['USD'].available += usdCost;
        userBalance[symbol].locked -= fillQty;

        restingUser['USD'].locked -= usdCost;
        restingUser[symbol] ??= { available: 0, locked: 0 };
        restingUser[symbol].available += fillQty;
      }
    }
    if (restingOrders.length === 0) oppositeSide.delete(levelPrice);
    if (order.filledQty >= order.qty) break;
  }

  if (order.filledQty === 0) order.status = 'open';
  else if (order.filledQty < order.qty) order.status = 'partially_filled';
  else order.status = 'filled';

  if (type === 'limit' && order.filledQty < order.qty) {
    const restingOrder: RestingOrder = {
      orderId,
      userId,
      side,
      type: 'limit',
      symbol,
      price: price!,
      qty: order.qty - order.filledQty,
      filledQty: 0,
      status: 'open',
      createdAt: order.createdAt,
    };

    const targetSide = side === 'buy' ? book.bids : book.asks;
    if (!targetSide.has(price!)) targetSide.set(price!, []);
    targetSide.get(price!)!.push(restingOrder);
  }

  if (type === 'limit' && side === 'buy' && order.filledQty < order.qty) {
    const unfilledCost = (order.qty - order.filledQty) * price!;
    void unfilledCost;
  }

  return order;
}

export interface CancelOrderInput {
  userId: string;
  orderId: string;
}

export function cancelOrder(input: CancelOrderInput): OrderRecord {
  const { userId, orderId } = input;

  const order = ORDERS.get(orderId);
  if (!order) throw new Error('order_not_found');

  if (order.userId !== userId) throw new Error('unauthorized');

  if (order.status === 'filled' || order.status === 'cancelled') {
    throw new Error('order_not_cancellable');
  }

  const book = ORDERBOOKS.get(order.symbol);
  if (book) {
    const targetSide = order.side === 'buy' ? book.bids : book.asks;

    const priceLevel = targetSide.get(order.price!);
    if (priceLevel) {
      const idx = priceLevel.findIndex((r) => r.orderId === orderId);
      if (idx !== -1) priceLevel.splice(idx, 1);
      if (priceLevel.length === 0) targetSide.delete(order.price!);
    }
  }

  if (!BALANCES.has(userId)) throw new Error('balance_not_found');
  const userBalance: any = BALANCES.get(userId)!;

  const unfilledQty = order.qty - order.filledQty;
  if (order.side === 'buy') {
    const refundUsd = unfilledQty * order.price!;
    userBalance['USD'].locked -= refundUsd;
    userBalance['USD'].available += refundUsd;
  } else {
    userBalance[order.symbol].locked -= unfilledQty;
    userBalance[order.symbol].available += unfilledQty;
  }

  order.status = 'cancelled';
  return order;
}
