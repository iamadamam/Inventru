# Inventru

Inventru keeps count of what is in your store room - mice, keyboards, monitors, laptops and so on - and shows
it on a TV, so everyone can see what is running low.

There are three parts:

1. **The server** - one computer (for example a virtual machine) that keeps the stock list.
2. **The store-room PC** - where people add and remove stock using the Inventru app.
3. **The TV** - shows the stock list live, in its web browser.

```
   Store-room PC    ---->     Server     ---->     TV
   (the app)                (the list)          (the dashboard)
```

> **No server, or just one PC?** The app also works on its own: install it and choose **Just this PC**. See
> [Using it without a server](#using-it-without-a-server-just-this-pc).


## What you need

* A Windows computer for the server: Windows 10, Windows 11, or Windows Server 2016 or newer (64-bit).
  It must stay switched on. A virtual machine is ideal.
* A Windows 10 or 11 PC (64-bit) for the store room.
* A TV (or any screen) with a web browser, on the same network.

**You don't need to install anything else.** No Microsoft Office or 365, no Google account, no Java, no .NET, no extra
downloads, and no internet connection - everything stays on your own network. Just unzip, install, use.


## Setting it up (about 10 minutes)

### Step 1 - The server

1. Copy the zip file to the server and unzip it (right-click > **Extract All**).
2. Open the **Server (VM)** folder and double-click **InventruServer**.
3. Windows asks *"Do you want to allow this app to make changes to your device?"* - click **Yes**.
   (Exactly what this changes is listed in [ABOUT.md](ABOUT.md), under *What the permission prompt changes*.)
4. A small window shows it setting up. After a few seconds a page opens in the web browser. It shows three things you
   will need:
   * the **TV address** (looks like `http://STOCK-VM:8080`)
   * the **server name**
   * a **6-digit pairing code**

That's all on the server. It now starts by itself whenever the computer is switched on, even if nobody signs in.

> **A yellow message about a "Public" network?** Then the PC and the TV can't reach the server yet. Change the server's
> network to Private (Windows Settings > Network & internet > your network > Network profile type), or ask IT.
>
> No browser on the server? The same three things are shown in the black window that opened.
>
> To see this page again later, double-click **InventruServer** again.

### Step 2 - The store-room PC

1. Copy the zip file to the store-room PC and unzip it.
2. Open the **Store-room PC** folder and double-click **Inventru-Setup**. It installs in a few seconds - no permission
   prompt - and puts **Inventru** on the desktop and in the Start menu.
3. Open **Inventru**. It asks for the **server name** and the **pairing code** from Step 1. Type them in and click
   **Connect**.

You only do this once. From then on the app opens by itself when someone signs in to the PC.

> Want the app on a second PC? Each code works for one PC. On the server's page, click **New code** and do Step 2 on
> that PC with the new code.

### Step 3 - The TV

Open the TV's web browser and go to the **TV address** from Step 1. Make it full screen.

That's it - the TV now updates by itself within a second of any change.


## Using it without a server (Just this PC)

1. On the PC, open the **Store-room PC** folder from the zip and double-click **Inventru-Setup**.
2. Open **Inventru** and click **Just this PC**.

That's all - no server, no pairing code, no permission prompt. Everything in *Everyday use* and *Adding and changing
items* below works the same.

What is different:

* The stock list is saved **on this PC only**. There is no TV dashboard, and other PCs can't see it.
* Each person who signs in to the PC with their own Windows account gets their own list.
* The change log and a daily backup (30 days) are kept next to the list. To see them: the cog (Settings) > **Open the
  folder**.
* As the list is on one PC, make a copy now and then: click the download arrow in the app to save it as a CSV file
  (it opens in Excel), or ask IT to include the folder in the PC's backups.

**Get a server later?** Set the server up (Step 1), then in the app click the cog > **Connect to a server…** and type
its name and pairing code. If the server's list is still empty, this PC's list is copied to it.

**Already using a server and want to stop?** Click the cog > **Use just this PC…**. The PC keeps a copy of the list;
the server's list is not changed.


## Everyday use

**Add or remove stock:** click the **+** or **−** next to an item.

**Type an exact number:** click the number, type the new amount, press Enter.

**Mark something as ordered:** click **No** in the *Ordered* column so it says **Yes**. Click again when it arrives.

**Find something:** type in the **Search** box at the top.

**Only see one kind of item:** click a category at the top (for example *Monitors*). Click **All** to see everything again.

Everything you change is saved on the server straight away. If the server can't be reached for a moment (for example
while it restarts), the top-right corner says **Offline** and your changes wait on the PC - they are sent automatically
as soon as it's back. Nothing is lost and nothing is counted twice. (With **Just this PC**, it is saved on the PC
straight away and the corner says **Saved on this PC**.)

**Coloured items:** an item turns **amber** when it gets low, and **red** when there are none left.

Prefer the keyboard? Press **?** in the app to see the shortcuts.


## Adding and changing items

Click **Edit** (top of the app). Now you can:

* **Add an item** - click **Add item**, then type its name.
* **Rename** - click the name and type.
* **Choose a category** (such as *Monitors*) and a **subcategory** (such as *New* or *Used*) from the drop-down lists.
  Pick **+ New category…** to make a new one.
* **Per click** - how many one click of + or − adds or removes (for example 5 if you count in packs of 5).
* **Warn at** - the item turns amber when it gets down to this number.
* **Move items** - drag them by the dotted handle on the left, even into another category.
* **Change an icon** - click the picture next to an item or category.
* **Hide** (eye button) or **delete** (bin button) an item.
* **Clear all "Ordered"** or **Set all quantities to 0** - both ask first and can be undone straight afterwards.

Click **Done** when you have finished.

**Lots of items to add?** Fill in [docs/import-template.csv](docs/import-template.csv) in Excel, save it as CSV, then in
**Edit** click **Import CSV**. Items already on the list are updated; new ones are added.


## Keeping it safe

* **PIN:** in the app, click the cog (Settings) > **Set PIN**. After that, Settings and Edit need the PIN, and they lock
  again after 5 minutes without use. Adding and removing stock stays open to everyone.
* **Backups:** the server (or, with Just this PC, the app) keeps a copy of the stock list every day for 30 days. You can
  also download one at any time: on the server's page click **Download a backup**, or in the app click the download
  arrow. It opens in Excel.
* **Who changed what:** a change log (`log.csv`, opens in Excel) records the time, the item, the change and who made
  it - on the server, or with Just this PC in the app's folder.


## If something goes wrong

**The app says "Cannot reach the server".**
Check the server computer is switched on. If it is, try typing the server's **number address** instead of its name
(the server page shows it, for example `192.168.0.20:8080`): click the cog > **Pair again**. If the server's page shows
a yellow message about a *Public* network, see Step 1.

**The app says "Wrong pairing code" or "not paired".**
On the server's page click **New code**, then in the app click the cog > **Pair again** and type the new code.
Each code works for one PC and for 30 minutes.

**The server's page shows "No code open right now".**
A code is used up once a PC has paired, or after 5 wrong tries. Click **New code**.

**The TV says "Reconnecting".**
The TV keeps showing the last numbers and catches up by itself when the server is back.

**Windows says "Windows protected your PC" when opening a file from the zip.**
Click **More info**, then **Run anyway**. (This appears because the programs aren't signed with a company certificate.)

**I want to remove a PC.**
On the server's page, under *Paired PCs*, click **Remove** next to it.


## Updating and removing

**Update the server:** double-click the new **InventruServer** and click **Yes**. It replaces the old one and keeps your
stock, the paired PCs and the address.

**Update the app:** run the new **Inventru-Setup**. It keeps your settings and pairing (and, with Just this PC, the
list).

**Remove the app:** Windows Settings > Apps > **Inventru** > Uninstall.

**Remove the server:** press the **Windows key + R**, paste the line below, press Enter and click **Yes**:

```
"C:\Program Files\inventrustock-server\InventruServer.exe" --uninstall
```

Removing either one keeps its data (see below) - delete those folders as well if you want everything gone.


## Where Inventru keeps things

Every folder Inventru makes starts with **inventrustock-**, so it is easy to find.

| What | Where |
|---|---|
| The server program | `C:\Program Files\inventrustock-server` |
| The stock list, change log and backups (server) | `C:\ProgramData\inventrustock-server` - only administrators can open it |
| The app | `C:\Users\<you>\AppData\Local\Programs\inventrustock-app` |
| The app's settings and changes waiting to be sent | `C:\Users\<you>\AppData\Roaming\inventrustock-app` |
| The stock list, change log and backups (Just this PC) | `C:\Users\<you>\AppData\Roaming\inventrustock-app\stock` |


## More information

* [ABOUT.md](ABOUT.md) - what Inventru is made with, exactly what installing changes, and how to build it.
* [docs/IT.md](docs/IT.md) - details for IT: network, security, deployment.
* [CHANGELOG.md](CHANGELOG.md) - what is in each version.
