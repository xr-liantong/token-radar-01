# Ownership note

owner.json names the entry wallet of the make.fun account that submits this repository:

```json
{"wallet": "2n9UokXd8zwK6RdBz12cMXwYEG3ULJSLaUDr5sbWHwGE"}
```

That wallet is the account's entry and payout wallet and it is the key that signs the entry message. No key material, seed phrase or private key is present anywhere in this repository: the wallet lives in the submitter's browser extension, and the transcript bundle carries no credential (checked for `gho_`, `ghp_`, `af_`, `sk-`, `DSH_SECRET` and `solana-keygen` secret-key markers: zero hits).
