# Split It

Split shared costs between friends, from rent and groceries to a dinner or a whole trip, and see the fewest payments needed to settle up.

**Live:** https://lazarzec18.github.io/split-it/

![Split It screenshot](screenshot.png)

## What it does

- Keeps separate groups like "House" or "Bali trip" so you can switch between them, and saves everything on your device.
- Logs each expense with who paid and who it's shared between. Split it equally, by exact amounts, or by shares (someone with 2 shares pays twice as much).
- Shows each person's balance as a bar left or right of zero, so you can see straight away who is up and who is down.
- Works out the shortest list of payments to settle up, like "Sam pays Alex $330.87".
- Copies a plain-text summary you can paste into the group chat.
- Handles AUD by default, plus NZD, USD, EUR, GBP, IDR and JPY for trips.

## How it works

All money is stored as whole cents, so there are no floating point errors. When an amount doesn't divide evenly, like $10 split three ways, the leftover cents go one at a time to people in group order ($3.34, $3.33, $3.33), and share-based splits use the largest-remainder method, so every split adds up to the exact total. To settle up, it repeatedly matches the person owed the most with the person who owes the most and has one pay the other the smaller of the two amounts. Each payment clears at least one person, so a group of n people never needs more than n − 1 payments.

## Built with

HTML, CSS and JavaScript. No frameworks, no build step.

## Run it locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

Then visit http://localhost:8000.

---

Made by [Lazar Zec](https://github.com/LAZARZEC18)
