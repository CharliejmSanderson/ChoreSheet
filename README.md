# Family Chores

A weekly chore roster that shares out work fairly, remembers what everyone's
done, and can be changed as the week goes on. It runs as a plain website, syncs
between everyone's phones, and installs to an iPhone Home Screen like a real app.

No servers to run, no monthly bill, no login to remember.

---

## Contents

1. [Have a look first](#1-have-a-look-first)
2. [Set up Firebase](#2-set-up-firebase)
3. [Add your Firebase keys](#3-add-your-firebase-keys)
4. [Set the database rules](#4-set-the-database-rules)
5. [Put it on GitHub Pages](#5-put-it-on-github-pages)
6. [Make the fridge QR code](#6-make-the-fridge-qr-code)
7. [Install it on everyone's phone](#7-install-it-on-everyones-phone)
8. [How the fairness works](#how-the-fairness-works)
9. [Tuning it](#tuning-it)
10. [About security](#about-security)
11. [What's in each file](#whats-in-each-file)
12. [If something goes wrong](#if-something-goes-wrong)

---

## 1. Have a look first

You don't need Firebase to try it. Open `index.html` through a local web server
and it runs in **preview mode** — fully working, but the data stays on that one
device and doesn't sync.

From the project folder, in the VS Code terminal:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

> Opening `index.html` by double-clicking it **won't work**. The app is built
> from JavaScript modules, and browsers block those on `file://` addresses. It
> has to be served over `http://`, which is all the command above does.

Have a click around, then come back and set up Firebase to make it shared.

---

## 2. Set up Firebase

Firebase is Google's free database service. It's what lets everyone's phones see
the same chore list. The free tier ("Spark") is far more than a family will ever
use, and it **doesn't ask for a credit card**.

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. Click **Create a project**. Name it anything (`family-chores` is fine).
3. Google Analytics is offered — **turn it off**. You don't need it.
4. When the project is ready, click **Build → Firestore Database** in the left
   sidebar, then **Create database**.
5. Choose a location near you (for Australia, `australia-southeast1`). This
   can't be changed later, but any choice works.
6. When asked, pick **Start in test mode**. You'll replace those rules in step 4.

---

## 3. Add your Firebase keys

Now tell the app which project to talk to.

1. In the Firebase console, click the **gear icon → Project settings**.
2. Scroll to **Your apps** and click the web icon: **`</>`**
3. Give it a nickname (`chores`), leave "Firebase Hosting" **unticked**, and
   click **Register app**.
4. You'll see a code block containing `const firebaseConfig = { ... }`. That's
   what you need.
5. Open `js/config.js` in VS Code and copy each value across, keeping the quotes:

```js
export const firebaseConfig = {
  apiKey: 'AIzaSy...',
  authDomain: 'family-chores.firebaseapp.com',
  projectId: 'family-chores',
  storageBucket: 'family-chores.appspot.com',
  messagingSenderId: '123456789012',
  appId: '1:123456789012:web:abc123',
};
```

Reload the page. The orange "Preview mode" banner should disappear — that's how
you know it's connected.

---

## 4. Set the database rules

Test mode from step 2 stops working after 30 days, so replace it now.

In the Firebase console: **Firestore Database → Rules**, then paste this and
click **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // This app has no login, so there's no user identity to check against.
    // Anyone who has the web address can read and change the chore list.
    // See "About security" in the README before using this for anything
    // more sensitive than chores.

    match /familyMembers/{doc} { allow read, write: if true; }
    match /chores/{doc}        { allow read, write: if true; }
    match /weeks/{doc}         { allow read, write: if true; }
    match /activityLog/{doc}   { allow read, write: if true; }
  }
}
```

Listing the four collections individually (rather than a blanket `match
/{document=**}`) means a stray script can't create junk collections in your
database. It's a small thing, but it costs nothing.

---

## 5. Put it on GitHub Pages

1. Create a new repository at <https://github.com/new>. Name it `chores`, set it
   to **Public** (GitHub Pages needs this on free accounts), and don't add a
   README — you already have one.
2. In VS Code, open this folder and run in the terminal:

```bash
git init
git add .
git commit -m "Family chore roster"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/chores.git
git push -u origin main
```

3. On GitHub, go to **Settings → Pages**.
4. Under **Source**, choose **Deploy from a branch**. Set the branch to `main`
   and the folder to `/ (root)`. Click **Save**.
5. Wait a minute or two, then refresh. GitHub shows your address:

```
https://YOUR-USERNAME.github.io/chores/
```

Open it and check the preview banner is gone.

**To update it later**, just push again:

```bash
git add .
git commit -m "What changed"
git push
```

Changes go live in a minute or so.

---

## 6. Make the fridge QR code

Take the GitHub Pages address from step 5 and paste it into any QR generator —
search "QR code generator", they're all much the same and free. Download it,
print it, stick it on the fridge.

Anyone can scan it to open the app. They only need the QR **once**, because of
the next step.

---

## 7. Install it on everyone's phone

This is what turns it from a website into an app icon.

**On iPhone — it must be Safari.** Other browsers can't do this.

1. Open the address in **Safari** (scan the fridge QR, or send them the link).
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**.

There's now a "Chores" icon on their Home Screen. Tapping it opens the app full
screen with no address bar. They never need the QR or the link again.

**On Android**, Chrome shows an "Install app" prompt, or use **⋮ → Add to Home
screen**.

Last step: each person taps **Who are you?** at the top right and picks their
name. That's what signs their name against anything they change.

---

## How the fairness works

Every person has a running total: everything they've ever been assigned. When
a chore needs allocating, whoever's total is lowest goes next — for every
single job, not just once a week. That one rule does everything at once:

**Every week is split as evenly as the numbers allow.** 10 jobs across 5
people is 2 each, every time. When it doesn't divide evenly — say 11 jobs
across 5 people — the split is 3/2/2/2/2, and the extra goes to whoever's most
behind overall.

**It correctly handles chores only some people can do** (see Restricting a
chore, below). Being excluded from a chore just means that person's total
stays a little lower, which naturally puts them first in line for whatever
they *are* eligible for — so it evens out rather than leaving them
permanently behind.

Within that, the per-chore counts decide *which* chores each person gets:
whoever's done that particular one least comes first. It isn't strictly
"lowest always wins" — that would make the roster completely predictable —
so anyone within one go of the lowest is in the running, and the pick among
them is random.

One more rule keeps it varied: **nobody gets the same chore two weeks running**
if someone else is equally due for it.

Marking someone **away** takes them out entirely for that week; the others
split the load evenly between them. The person who was away has done fewer
overall, so they're first in line for the following week's jobs.

**Editing a week doesn't break any of this.** The totals are always
recalculated from what people actually ended up doing, so swaps and
reassignments are counted, not the original draw.

The **Tasks** tab shows the running tally: each person's total, and a
breakdown of every chore with how many times they've done it.

### Drawing up a week

Tap **Draw up this week** and you get three choices:

- **Share them out for me** — the app allocates everything.
- **I'll allocate them myself** — the week is created empty and you tap each
  chore to choose who does it.
- **Cancel** — closes the sheet without changing anything.

If you start allocating by hand and run out of patience, **Fill the rest** hands
the remainder to the app. Anything you already chose is kept exactly as it is,
and the automatic pass balances around those choices rather than ignoring them.

You can also leave a chore deliberately unallocated — open it and choose
**Leave it unallocated**.

**Redrawing an existing week** replaces its current list. Right afterwards, a
banner offers **Undo** to put it back exactly as it was — this disappears the
moment you make any other change to that week, since at that point there's no
longer a single clear "before" to return to.

### Restricting a chore

A chore can be left open to **anyone**, or restricted to **adults only** or
**kids only** — set this when adding or editing the chore. Whether a person
counts as a "kid" for this purpose is set on their own profile (the "skips
adults-only chores" toggle in Manage), and it works both ways: someone marked
that way will never be given an adults-only chore, and will never be given a
kids-only chore either if they're not marked that way.

### Notes on chores

Each chore can carry a standing note — "must be done before 5pm", "bins go out
Tuesday night", "use the good polish". It shows with the chore every week, in
the week list and when allocating it.

Notes are saved with each week as it's drawn up, so changing a note later won't
rewrite what past weeks said.

### Who's making the change

Once at least one person is in the family, editing anything — chores,
assignments, swaps, redrawing a week — asks who you are first, if this device
hasn't said already. That's what makes the Activity tab meaningful. The one
exception is adding the very first person(s) to an empty family, since there's
nobody to pick from yet.

---

## Tuning it

If the roster needs adjusting, open `js/schedule.js`. The four dials are at the
very top of the file, each with a comment explaining what it does:

| Setting | Default | What it does |
| --- | --- | --- |
| `HISTORY_WEEKS` | 0 | How far back the counts look. 0 means all time, which is what makes the totals even out long-term. Set a number to make old history stop counting. |
| `COUNT_TOLERANCE` | 1 | How close to the lowest count you have to be to still be in the running for a specific chore. 0 is strictest and most predictable; higher means more variety and slower evening-out. |
| `REPEAT_PENALTY_WEEKS` | 1 | How long before someone can get the same chore again. Set to 0 to allow repeats. |
| `TOTAL_TOLERANCE` | 0 | How close to the lowest overall total counts as "equally due" for the next job. This is what keeps a week's jobs split evenly — 0 is strictest. Raise it to 1 for a little more shuffle at the cost of a slightly less even split. |

Nothing else in the file needs touching to change how the roster behaves.

---

## About security

**Anyone with the web address can read and change everything.** There's no login,
and the "who are you?" name is chosen, not verified — someone could pick another
family member's name and act as them.

This is a deliberate trade-off, not an oversight. Adding real accounts would mean
passwords to reset and a login screen between your family and the chore list,
for a tool whose worst-case outcome is an argument about the bins. The
**Activity** tab is the safeguard instead: every change is recorded with a name
and a timestamp, and it can't be edited from inside the app.

What this does mean:

- The GitHub Pages address is public. It's unlikely anyone will find it, but
  it isn't secret — treat it as discoverable.
- Don't put anything private in chore names.
- The Firebase keys in `config.js` are meant to be public (that's normal for web
  apps) — the database rules are what control access, not the keys.

If you later want to lock it down, the two paths are [Firebase
Authentication](https://firebase.google.com/docs/auth) for real logins, or
[Firebase App Check](https://firebase.google.com/docs/app-check) to at least
restrict access to your own site. Both work on the free tier.

---

## What's in each file

```
index.html            Page shell, Home Screen install tags, font loading
manifest.json         App name and icons for the installed app
css/app.css           All styling, design tokens at the top
icons/                App icons

js/config.js          ← the only file you have to edit
js/schedule.js        The fairness engine. Pure logic, tunable constants on top
js/store.js           Reading and writing data (Firestore, or local preview)
js/views.js           The four screens and all the pop-up sheets
js/ui.js              Shared bits: buttons, chips, sheets, icons
js/ics.js             Calendar file export
js/app.js             Startup, navigation, and what each button does
```

`schedule.js` has no connection to Firebase or the screen, so you can change how
chores are shared out without touching anything else.

---

## If something goes wrong

**The orange preview banner won't go away.**
A value in `js/config.js` is still a placeholder, or one got pasted with a typo.
Open the browser console (on desktop: F12 → Console) for the specific error.

**"Missing or insufficient permissions" in the console.**
The database rules haven't been published. Redo step 4.

**Blank page after opening index.html directly.**
You need a local web server — see the note in step 1.

**GitHub Pages shows a 404.**
Give it a few minutes after first enabling. Check that the repository is public
and that Pages is pointed at the `main` branch, root folder.

**Changes don't appear on other phones.**
Check the preview banner is gone on *both* devices. If one is still in preview
mode, it's saving to itself.

**"Add to Home Screen" isn't in the Share menu.**
The page is open in something other than Safari. iOS only offers it there.

**The roster looks unfair.**
Check the **Tasks** tab — it shows exactly how many times each person has done
each chore. A difference of one or two is normal and evens out. If one person is
genuinely ahead, it's usually because they were away, or because a chore is
adults-only and so can only go to some people.

---

## A note on what this doesn't do

It won't text or email anyone, and it won't send notifications. Anything that
pushes a message out on its own needs a paid backend service, so the app is
built around people opening it instead — which is why the Home Screen install
matters. The calendar export is there if someone would rather have their chores
appear alongside the rest of their week.