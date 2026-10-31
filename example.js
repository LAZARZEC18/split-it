// Split It: the "Load example" group. A realistic Bali trip for four, dated relative to today.
(function (global) {
'use strict';

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function exampleGroup() {
  const M = 'maya', S = 'sam', A = 'ari', J = 'jess';
  const all = [M, S, A, J];
  let t = Date.now() - 20 * 86400000;
  const e = (o) => Object.assign({
    id: 'ex' + Math.random().toString(36).slice(2, 9), kind: 'expense', currency: 'AUD', mode: 'equal',
    participants: all, notes: '', created: (t += 3600000),
  }, o);
  return {
    name: 'Bali trip', emoji: '🏝️', color: 'teal', currency: 'AUD', isExample: true,
    people: [{ id: M, name: 'Maya' }, { id: S, name: 'Sam' }, { id: A, name: 'Ari' }, { id: J, name: 'Jess' }],
    expenses: [
      e({ desc: 'Villa in Canggu, 5 nights', amount: 128000, category: 'accommodation', paidBy: M, date: isoDaysAgo(9),
        notes: 'Booked on Airbnb. Includes the cleaning fee.' }),
      e({ desc: 'Airport transfer', amount: 4800, category: 'transport', paidBy: S, date: isoDaysAgo(9) }),
      e({ desc: 'Pepito groceries', amount: 8640, category: 'groceries', paidBy: J, date: isoDaysAgo(8),
        notes: 'Breakfast stuff, water and snacks for the villa.' }),
      e({ desc: 'Scooter hire, 4 days', amount: 9600, category: 'transport', paidBy: S, date: isoDaysAgo(8), mode: 'shares',
        participants: [M, S, A], shares: { [M]: 100, [S]: 200, [A]: 100 }, notes: 'Sam kept his for the extra trip to Uluwatu. Jess walked.' }),
      e({ desc: 'Dinner at La Brisa', amount: 17365, category: 'food', paidBy: A, date: isoDaysAgo(7), mode: 'items',
        items: [
          { id: 'i1', name: 'Grilled snapper to share', amount: 3800, people: [M, S] },
          { id: 'i2', name: 'Wagyu burger', amount: 2600, people: [A] },
          { id: 'i3', name: 'Nasi goreng', amount: 1600, people: [J] },
          { id: 'i4', name: 'Cocktails, round of four', amount: 5600, people: all },
          { id: 'i5', name: 'Mie goreng', amount: 1500, people: [S] },
        ], taxPct: 1000, tipPct: 500, notes: '10% tax and 5% service on the bill.' }),
      e({ desc: 'Mount Batur sunrise trek', amount: 34000, category: 'activities', paidBy: A, date: isoDaysAgo(6) }),
      e({ desc: 'Spa afternoon', amount: 18700, category: 'activities', paidBy: J, date: isoDaysAgo(6), mode: 'exact',
        participants: [M, A, J], exact: { [M]: 6500, [A]: 5700, [J]: 6500 }, notes: 'Ari had the shorter massage.' }),
      e({ desc: 'Beach club day', amount: 26450, category: 'food', paidBy: M, date: isoDaysAgo(5) }),
      e({ desc: 'SIM cards and data', amount: 5200, category: 'bills', paidBy: S, date: isoDaysAgo(9) }),
      e({ desc: 'Driver to Uluwatu', amount: 7500, category: 'transport', paidBy: A, date: isoDaysAgo(4) }),
      e({ desc: 'Warung lunch', amount: 3480, category: 'food', paidBy: J, date: isoDaysAgo(4) }),
      e({ desc: 'Temple tickets', amount: 4400, category: 'activities', paidBy: M, date: isoDaysAgo(4) }),
    ],
  };
}

global.SplitExample = { exampleGroup, isoDaysAgo };
})(typeof window !== 'undefined' ? window : globalThis);
