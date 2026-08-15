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

Every chore has a **weight** — how much of a pain it is. Walking the dog might be
3, putting the bins out 1. The numbers are relative and only ever compared to
each other, so use whatever scale suits you.

When a week is drawn up:

1. **Chores become individual jobs.** A weekly chore is one job for one person.
   A daily chore becomes seven separate jobs, one per day — so a rotating chore
   genuinely rotates instead of landing on one person for the whole week.
2. **Everyone's recent load is added up** from the last few weeks, using the
   weights that were in effect at the time.
3. **The heaviest jobs are handed out first**, each going to whoever's carrying
   the least at that moment.
4. **Scores update as it goes**, so the lighter jobs fill in the gaps and
   everyone lands near the same total.

Three things stop it feeling mechanical:

- **Near-ties are broken randomly**, so it isn't a predictable rotation.
- **Nobody gets the same chore two weeks running** if someone else is equally
  due for it.
- **Nobody gets buried in one week.** Someone coming back from a week away has a
  backlog, but it's spread over a few weeks rather than dumped on them at once.

Marking someone **away** takes them out entirely for that week. They're not let
off — they've simply carried less, so they come up first once they're back.

**Editing a week doesn't break any of this.** Fairness is always recalculated
from what people actually ended up doing, so swaps and reassignments count. And
changing a chore's weight only affects future weeks: past weeks keep the weight
they were drawn up with, so history stays honest.

---

## Tuning it

Getting the weights right takes a few weeks of real use. Adjust them in
**Manage** whenever something feels off — it only affects future weeks.

If the roster itself needs adjusting, open `js/schedule.js`. The four dials are
at the very top of the file, each with a comment explaining what it does:

| Setting | Default | What it does |
| --- | --- | --- |
| `TRAILING_WEEKS` | 6 | How far back fairness looks. Lower reacts faster, higher smooths more. |
| `TIE_TOLERANCE` | 1 | How close two scores must be to count as tied. Higher means more shuffle, lower means stricter fairness. |
| `REPEAT_PENALTY_WEEKS` | 1 | How long before someone can get the same chore again. Set to 0 to allow repeats. |
| `MAX_WEEKLY_SHARE` | 1.3 | Ceiling on one person's load in a single week, as a multiple of a fair share. Raise it to let people catch up faster after being away. |

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
Have a look at the **Balance** tab first — it shows the last six weeks, and a
spread of a few points is normal and evens out. If it's genuinely lopsided, the
weights are usually the culprit rather than the algorithm.

---

## A note on what this doesn't do

It won't text or email anyone, and it won't send notifications. Anything that
pushes a message out on its own needs a paid backend service, so the app is
built around people opening it instead — which is why the Home Screen install
matters. The calendar export is there if someone would rather have their chores
appear alongside the rest of their week.
