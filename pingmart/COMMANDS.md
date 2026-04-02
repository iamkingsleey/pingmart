# Pingmart — Bot Commands Reference

> Last updated: April 2026
> These commands can be sent by any user at any point in a conversation to trigger actions instantly, regardless of current session state. All commands are case-insensitive.

---

## Global Commands

> Work for everyone — vendors, customers, and new users — at any time.


| Command    | Pidgin Alias | Action                                                                                 |
| ---------- | ------------ | -------------------------------------------------------------------------------------- |
| `RESET`    | —            | Wipe session completely and start fresh from language selection                        |
| `MENU`     | `HOME`       | Go back to the main intent screen (dashboard for vendors, intent screen for customers) |
| `LANGUAGE` | —            | Re-open language selection without resetting anything else                             |
| `HELP`     | `ASSIST`     | Show available commands relevant to your current role                                  |
| `CANCEL`   | `COMOT`      | Cancel current action and go back one step                                             |
| `SKIP`     | —            | Skip the current optional step and advance to the next                                 |


---

## Customer Commands

> Available to users in the customer shopping flow.


| Command  | Pidgin Alias   | Action                                  |
| -------- | -------------- | --------------------------------------- |
| `CART`   | `MY CART`      | View your current cart at any time      |
| `CLEAR`  | —              | Empty the cart and start shopping again |
| `DONE`   | `I DON FINISH` | Proceed to checkout from anywhere       |
| `ORDERS` | —              | View your last 5 order history          |


---

## Vendor Commands

> Available to users who have set up or are setting up a store.


| Command     | Pidgin Alias | Action                                                                                  |
| ----------- | ------------ | --------------------------------------------------------------------------------------- |
| `DASHBOARD` | —            | Jump straight to your vendor dashboard                                                  |
| `ADD`       | —            | Go directly to the add products step                                                    |
| `CATALOGUE` | —            | View your current product list with item numbers and prices                             |
| `HOURS`     | —            | Go directly to the update business hours step                                           |
| `PAUSE`     | `CLOSE SHOP` | Temporarily pause your store — customers will see a "temporarily unavailable" notice    |
| `RESUME`    | `OPEN SHOP`  | Reactivate a paused store                                                               |
| `EDITED`    | —            | Signal the bot to re-fetch your updated Google Sheet or re-upload an updated Excel file |
| `HANDLED`   | —            | Mark an escalated customer support issue as resolved                                    |


---

## Notes

- All command responses are sent in the user's selected language
- Commands are checked before any other routing logic — they always take priority
- `RESET` is the nuclear option — it clears everything including language preference
- `CANCEL` only rolls back one step — use `RESET` to start completely over
- `PAUSE` / `CLOSE SHOP` does not delete your store or products — it only hides it temporarily
- `EDITED` only works if you previously shared a Google Sheets link during catalogue setup
- `HANDLED` only works during an active support escalation

