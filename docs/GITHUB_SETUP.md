# GitHub Setup

Suggested repository:

```text
schlambos/harmony-hub-control
```

Recommended visibility: private while the project still ships local-control
device binaries and no-auth LAN UI behavior.

## Create The Remote Repo

Create an empty repository on GitHub named `harmony-hub-control`. Do not add a
README, license, or `.gitignore` in the GitHub wizard because this folder
already contains them.

Then invite your colleague from:

```text
Settings -> Collaborators and teams
```

## Push From A Machine With Git

From this folder:

```powershell
git init
git add .
git commit -m "Initial Harmony Hub Control web UI"
git branch -M main
git remote add origin https://github.com/schlambos/harmony-hub-control.git
git push -u origin main
```

## Clone Workflow For Collaborators

```powershell
git clone https://github.com/schlambos/harmony-hub-control.git
cd harmony-hub-control
```

Deploy to a rooted test hub:

```powershell
.\install_webui.ps1 -HubHost <hub-ip> -KeyPath "$env:USERPROFILE\.ssh\<root-key-file>"
```

## Branches

Use short feature branches:

```powershell
git checkout -b feature/ir-import-parser
```

Keep `main` installable.
