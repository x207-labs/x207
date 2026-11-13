# x207 demo video: script (target 2:55)

This file mirrors the recorded script. It is a draft: nothing here was posted, and the owner publishes the post ([x-post.md](x-post.md), form: [form-draft.md](form-draft.md)).

Narration in English, production notes in Indonesian. Every number has a source in the "Source" line of its scene. Nothing here is a claim beyond those sources. Everything ran on **testnet** with a **mock USDT** (`usdt.x207-deployer.testnet`); no mainnet transaction has been sent.

| # | Scene | Time | Length |
|---|---|---|---|
| 1 | Hook | 0:00–0:15 | 15 s |
| 2 | Pricing | 0:15–0:50 | 35 s |
| 3 | Matching | 0:50–1:40 | 50 s |
| 4 | Timing and safety | 1:40–2:15 | 35 s |
| 5 | Developer | 2:15–2:35 | 20 s |
| 6 | Close | 2:35–2:55 | 20 s |

Narasi ±2,3 kata per detik. Kalau terlalu cepat, potong kalimat terakhir tiap adegan (ditandai *(boleh dipotong)*).

---

## Scene 1. Hook (0:00–0:15)

**Layar:** `https://x207.vercel.app/` (landing). Diam di hero 5 detik, lalu pelan scroll sedikit. Jangan klik.

**Narasi:**
> Barter failed for three reasons: matching, pricing, timing.
> x207 fixes all three for AI agents on NEAR.
> x402 lets agents pay. x207 lets them pay with anything of value. Here it is, on testnet.

**Catatan:** kalimat 1 dan 2 persis dari pemilik. Kalimat 3 dan 4 mengikuti lede landing ("x402 lets agents pay. x207 lets them pay with anything of value...") dan menyebut "testnet" sejak awal supaya tidak ada kesan mainnet.

---

## Scene 2. Pricing (0:15–0:50)

**Layar:**
1. `https://x207.vercel.app/marketplace`, pilih circle **v018** (pemilih circle di shell). (0:15)
2. Scroll ke listing yang punya badge "Appraised on NEAR AI Cloud (TEE) · signature checked". Zoom pelan ke badge: nilai dan range. (0:22)
3. Klik tombol **proof**. Dialog "Appraisal proof" terbuka: model, signing address, daftar cek (signature, key binding, TDX quote, GPU evidence) dengan hasil pass/skipped. Biarkan 8 detik. (0:30)
4. Tab kedua: `https://v018.x207.boxd.sh/x207/appraisals/apr_6edab5eac2b78e65d41ea3b2`, tunjukkan JSON sebentar (`model`, `result.value_credits`). (0:42)

**Narasi:**
> Pricing. An API quota or a licence has no market price.
> So x207 asks an appraiser on NEAR AI Cloud, running inside a TEE, to value the asset in credit.
> Each listing carries a badge, and the proof panel shows what was checked.
> Signature checked locally; quote checked via third-party verifiers, Phala and NVIDIA NRAS.
> The value is advice only. The contract never reads it.

**Source:** `README.md` bagian "Asset appraiser on NEAR AI Cloud (TEE)" dan `backend/README.md` bagian Appraiser; model `Qwen/Qwen3.6-35B-A3B-FP8` ada di JSON appraisal `apr_6edab5eac2b78e65d41ea3b2` (dilihat 2026-11-13: Mapbox, harga pasar 75, nilai 60, range 45–70). Badge dan dialog proof: frontend commit `74bfd34` (FE-111).

**Catatan produksi:**
- **Cek sebelum rekam:** listing mana di circle v018 yang benar-benar membawa badge. Kode FE-111 menampilkan badge hanya bila `detail` listing menyebut `appraisal=apr_...`. Saya tidak melihat halaman live; saya hanya membaca kode dan mengambil JSON appraisal. Kalau tidak ada listing berbadge di v018, rekam JSON appraisal saja dan potong langkah 1–3.
- Jangan sebut "DCAP-verified", "trustless", atau "validator". Kalimat klaim di atas jangan diubah.
- Kalau dialog menampilkan satu cek "skipped", biarkan; itu jujur (di README backend: signature refetch tanpa key = SKIP).

---

## Scene 3. Matching (0:50–1:40)

**Layar:**
1. `https://x207.vercel.app/stats?epoch=184&circle=v018` (dashboard epoch 184). (0:50)
2. Tunjuk graf kewajiban: tiga node alice, bob, dan2 dalam satu lingkaran. (0:55)
3. Tunjuk angka clearing: cleared 72, ratio 0.8889, net debt 8. (1:10)
4. Buka dua tx di nearblocks, masing-masing 4 detik:
   - `submit_clearing`: `https://testnet.nearblocks.io/txns/AAUVpLjAY2TrcJNDjVSyimXUDififQdttiX7oceQHvFc` (1:22)
   - settle alice membayar 8: `https://testnet.nearblocks.io/txns/5gd31nuATR78nXTaJ476CWC2HAg9UK51aGK31diXSsb5` (1:30)

**Narasi:**
> Matching. Three agents each hold something another one wants, but no pair wants each other's asset.
> Alice has a Mapbox geocoding quota, valued at 24 credit. Bob has a JetBrains licence, 32. Dan has FastNEAR RPC access, 25.
> A team script signs for all three.
> They trade in a ring: alice to bob, bob to dan, dan to alice. 81 credit of trade.
> The circle contract nets every position, so only 8 USDT actually moves.
> The solver's proposal removes 72 of the 81 from the gross record.

**Source:** `agents/docs/demo-barter-cycle.md` (AG-052, 2026-11-12, `x207-v018.testnet`, epoch 184): nilai 24 / 32 / 25; bruto 81; dibatalkan 72 (88.9%); net position alice −8, bob +7, dan2 +1; "8 USDT moved, 9.9% of gross"; metrics API `cleared` 72000000, `clearedRatio` 0.8889, `netDebt` 8000000. Nama member di data: `dan2` (di narasi dibaca "Dan").

**Catatan produksi:**
- Jangan bilang "tanpa uang tunai sama sekali": 8 USDT (mock) tetap berpindah. Narasi sudah benar; jangan diubah jadi "zero cash".
- Jangan bilang clearing yang memotong uang tunai: 8 USDT adalah posisi net dari netting kontrak, tidak bergantung pada solver. Angka 72 hanya mengurangi catatan kewajiban bruto.
- Satu skrip tim menandatangani untuk ketiga agent (alice, bob, dan2); jangan bilang tiga agent independen.
- Jangan bilang "x207 hemat gas". README payung menulis epoch ini justru lebih mahal dari transfer biasa; tidak ada klaim gas di naskah ini.
- Jangan sebut semua nilai sebagai "harga pasar": itu nilai appraiser (saran). Tabel di sumber memuat harga pasar 30 / 32 / 28 dan nilai appraiser 24 / 32 / 25.
- Dashboard lambat memuat: buka tab dari awal dan refresh sekali sebelum rekam.

---

## Scene 4. Timing and safety (1:40–2:15)

**Layar:**
1. Kembali ke `https://x207.vercel.app/marketplace` (listing menunggu penjual). (1:40)
2. Tab nearblocks tx yang ditolak: `https://testnet.nearblocks.io/txns/Dq9zmg4dTeK7M17f24wcwcGGEgtiefakrrn9A66aQXev`. Zoom ke baris error `ERR_INSUFFICIENT_CREDIT`. (1:50)
3. Tab nearblocks tx pertama yang diterima: `https://testnet.nearblocks.io/txns/GuQjUumDLVu86PqX5TqHDri1BrszuHgi7uxbH3PQfiRQ`, 3 detik, untuk kontras. (2:02)
4. Tab `https://github.com/x207-labs/sdk#overspend-across-sellers-settlemode-register-first-sd-121`, tunjuk kode `settleMode: "register-first"`. (2:07)

**Narasi:**
> Timing. The other side may not be able to deliver today.
> So agents trade on mutual credit: a signed voucher is served at once, and settled at the end of the epoch, backed by a stake.
> What stops an agent from overspending?
> Bob signed two vouchers of 75 credit, with room for only 125. The contract registered the first, and refused the second with insufficient credit.
> A seller can also register first, then serve: that is the register-first mode.

**Source:** `contracts/docs/testnet-epochs/ct132-overspend-run.json` (CT-132, circle `x207-v018.testnet`, epoch 183): `headroomBefore` 125000000, `amountEach` 75000000; tx pertama `GuQjUumD…` diterima; tx kedua `Dq9zmg4d…` gagal dengan "ERR_INSUFFICIENT_CREDIT: delta 75000000 headroom 50000000". Mode register-first: `sdk/README.md` bagian "Overspend across sellers: `settleMode: "register-first"` (SD-121)".

**Catatan produksi:**
- Tx `Dq9zmg4d…` adalah transaksi yang **gagal**; nearblocks menampilkan status Failed. Itu yang diinginkan.
- Batas jujur, jangan dilewati kalau narasi diperpanjang: dalam run CT-132 fasilitatornya mock dan respons middleware diputar ulang dari jawaban chain yang tercatat (bagian `notCovered` di JSON). Narasi di atas hanya menyebut hasil on-chain, bukan seluruh jalur seller.
- Tidak ada klaim "bebas risiko": mode register-first menambah satu panggilan on-chain (±2 detik) per respons, dan bila handler gagal setelah voucher terdaftar, pembeli tetap dikenai biaya (sdk README "What stays open").
- Angka "125" dan "75" dalam credit (1 credit = 1 mock USDT; JSON menyimpan 125000000 dan 75000000 dengan 6 desimal).

---

## Scene 5. Developer (2:15–2:35)

**Layar:**
1. `https://x207-docs.vercel.app` (halaman depan docs). (2:15)
2. Klik **Ask AI** (atau Ctrl+K). Ketik: `How do I add x207 to an agent that uses x402?` Tunggu jawaban 4–5 detik. (2:20)
3. Buka halaman SDK di docs (menu "sdk"), tunjuk satu baris `register("x207:agents-main", new X207SchemeClient(...))`. (2:28)

**Narasi:**
> For developers: the docs site has an Ask AI box.
> An agent that already uses x402 adds one line to its client, and a voucher pays any seller in the circle.

**Source:** `README.md` payung bagian "Adding x207 to an agent that uses `@x402/fetch`" (baris `new x402Client().register("x207:agents-main", new X207SchemeClient({ payer: "agent.near", secretKey }))`); tombol Ask AI: `docs-site/src/app/(home)/page.tsx` dan `docs-site/src/components/ai/chat/index.tsx`.

**Catatan produksi:**
- **Cek sebelum rekam:** Ask AI mungkin memakai kuota/limit (`docs-site/src/lib/ai/limits.ts`). Coba satu pertanyaan sebelumnya; kalau jawabannya aneh, pakai pertanyaan lain atau potong langkah 2. Jawaban Ask AI tidak saya periksa; jangan ditampilkan lama bila isinya klaim di luar naskah.
- `secretKey` adalah kunci voucher, bukan kunci akses NEAR. Jangan tampilkan nilai kunci apa pun di layar.

---

## Scene 6. Close (2:35–2:55)

**Layar:**
1. `https://github.com/x207-labs/x207` (README, bagian atas dengan tabel Matching/Pricing/Timing). (2:35)
2. Scroll ke baris yang menyatakan testnet dan mainnet belum jalan. (2:43)
3. Frame akhir: logo x207 + teks `x207.vercel.app` dan `github.com/x207-labs/x207` (pasang di editor). (2:50)

**Narasi:**
> Everything you saw is live on NEAR testnet, with a mock USDT.
> Mainnet has not run yet. The runbook is ready.
> The code, the evidence and the docs are linked below. Thank you.

**Source:** `README.md` payung: "Mainnet has not run: no mainnet transaction has been sent and a mainnet deployment is still being prepared"; `docs/mainnet-runbook.md` ada di repo payung.

**Catatan produksi:** jangan ganti "runbook is ready" dengan "mainnet soon" atau tanggal apa pun. Tidak ada tanggal mainnet di sumber.

---

## Kata yang tidak boleh diucapkan

"DCAP-verified", "trustless", "validator", "only NEAR", "mainnet live", "cash-free", "saves gas", "guaranteed", "audited" (review keamanan internal bukan audit pihak ketiga).

---

## Draft post X

Satu post (hitungan karakter dicek di bawah, batas 280):

```
Built at NEAR HACKATHON. Barter failed for three reasons: matching, pricing, timing. x207 fixes all three for AI agents on NEAR.

Testnet demo: a 3-agent ring traded 81 credit, 8 USDT moved (mock USDT, no mainnet).

https://x207.vercel.app
```

Panjang post: 239 karakter (tautan dihitung 23; panjang penuh tautan juga 23).

Thread (tiga tweet, tiap satu ≤ 280 karakter):

```
1/ Matching. Alice has a Mapbox quota, Bob a JetBrains licence, Dan FastNEAR RPC access. No pair wants each other's asset, but they form a ring. The circle contract cancels the loop: 72 of 81 credit, and only 8 USDT moves. Testnet, epoch 184: https://x207.vercel.app/stats?epoch=184&circle=v018
```

```
2/ Pricing. An appraiser on NEAR AI Cloud (TEE) values the asset in credit. Signature checked locally; quote checked via third-party verifiers (Phala, NVIDIA NRAS). The value is advice, the contract does not read it. https://v018.x207.boxd.sh/x207/appraisals/apr_6edab5eac2b78e65d41ea3b2
```

```
3/ Timing. Agents trade on mutual credit backed by a stake. A second 75-credit voucher over the limit is refused on chain: ERR_INSUFFICIENT_CREDIT. Testnet only, mainnet has not run. Docs: https://x207-docs.vercel.app Code: https://github.com/x207-labs/x207
```

**Source angka:** 81 / 72 / 8 dari `agents/docs/demo-barter-cycle.md`; 75 dan `ERR_INSUFFICIENT_CREDIT` dari `contracts/docs/testnet-epochs/ct132-overspend-run.json`.

**Catatan:** link di X dihitung 23 karakter oleh X, jadi batas sebenarnya longgar; hitungan di sini memakai panjang penuh (lebih ketat). Jangan posting sebelum pemilik membaca; ini draf, tidak ada yang diposting.

---

## Tab browser yang harus dibuka sebelum rekam

Urutan tab kiri ke kanan. Semua dibuka dan di-refresh 5 menit sebelum rekam. Jendela browser 1920×1080, zoom 110%, mode terang atau gelap sama di semua tab, tutup bookmark bar dan notifikasi.

| Tab | URL | Dipakai di |
|---|---|---|
| 1 | `https://x207.vercel.app/` | Scene 1 |
| 2 | `https://x207.vercel.app/marketplace` (circle v018 dipilih) | Scene 2, 4 |
| 3 | `https://v018.x207.boxd.sh/x207/appraisals/apr_6edab5eac2b78e65d41ea3b2` | Scene 2 |
| 4 | `https://x207.vercel.app/stats?epoch=184&circle=v018` | Scene 3 |
| 5 | `https://testnet.nearblocks.io/txns/AAUVpLjAY2TrcJNDjVSyimXUDififQdttiX7oceQHvFc` (submit_clearing 184) | Scene 3 |
| 6 | `https://testnet.nearblocks.io/txns/5gd31nuATR78nXTaJ476CWC2HAg9UK51aGK31diXSsb5` (settle alice 8 USDT) | Scene 3 |
| 7 | `https://testnet.nearblocks.io/txns/Dq9zmg4dTeK7M17f24wcwcGGEgtiefakrrn9A66aQXev` (voucher ditolak) | Scene 4 |
| 8 | `https://testnet.nearblocks.io/txns/GuQjUumDLVu86PqX5TqHDri1BrszuHgi7uxbH3PQfiRQ` (voucher diterima) | Scene 4 |
| 9 | `https://github.com/x207-labs/sdk` (anchor bagian register-first) | Scene 4 |
| 10 | `https://x207-docs.vercel.app` | Scene 5 |
| 11 | `https://github.com/x207-labs/x207` | Scene 6 |

Sebelum rekam: tidak ada wallet yang perlu tersambung; semua adegan read-only. Tutup tab lain, mode jangan-ganggu aktif, dan jangan tampilkan `.env` atau kunci di layar.

---

## Cek yang belum saya lakukan (jujur)

- Saya **tidak membuka** `x207.vercel.app/marketplace`, dashboard epoch 184, atau nearblocks di browser. Yang saya cek: JSON appraisal live (200, model dan nilai cocok), `x207-docs.vercel.app` dan `x207.vercel.app/marketplace` menjawab HTTP 200, serta isi file sumber di repo.
- Badge appraisal dan dialog proof saya baca dari kode FE-111 (`74bfd34`), bukan dari layar. Teks di layar bisa berbeda.
- Status tx nearblocks (Failed untuk `Dq9zmg4d…`) tidak saya lihat; sumbernya JSON CT-132.
- Ask AI tidak saya coba.
- Durasi narasi dihitung dari jumlah kata (±2,3 kata/detik), belum diucapkan dan diukur.
