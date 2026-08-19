# MY Scoring Cohort — Rater Kit

Companion to `rubric.en.json` / `rubric.ms.json` (schema `my-cohort-rubric/1`).

> This kit is used for the human calibration panel of the MY scoring cohort
> harness. Raters score synthetic resumes (see `scripts/generate-my-cohort.ts`)
> on five dimensions at 1–5, then give an overall rating. The scores feed the
> inter-rater reliability gate (`scripts/run-my-cohort-gate.ts`).

---

## 1. Purpose

The cohort measures how consistently raters and the AI scorer rank the same
resumes. Raters must agree on **what the numbers mean** before rating. This kit
standardises:

1. The meaning of each anchor (via the BARS rubric).
2. The order and discipline of rating (dimensional first, overall last).
3. Calibration against practice cases before the real panel run.

## 2. Materials

- Rubric JSON (EN or MS, your choice) — the only scoring reference.
- One resume per candidate (synthetic, zero PII — real names never appear).
- Rating sheet: one row per candidate, five dimension columns + overall column + notes.

## 3. Frame-of-Reference (FoR) Calibration

Before rating the panel, rate the three practice vignettes below, then compare
against the calibration feedback. Discuss any disagreement with the panel lead
until the team's anchors align. **Never rate the real panel before completing
this step.**

### Vignette A — Strong CNC Engineer (Bayan Lepas FIZ)

A 34-year-old candidate with 9 years at a Penang semiconductor tooling firm:
CNC programmer/machinist → senior machinist → tooling lead. Operates 5-axis
milling, CAM programming (Mastercam), GD&T, and first-article inspection.
Diploma in Mechanical Engineering from a local polytechnic (UiTM), plus an
OSHA/KKP safety certificate. Continuous 3+ years per role, one internal
transfer, no gaps. Bilingual EN/BM, writes reports in English. Applied for a
CNC programming role at another Bayan Lepas tooling shop.

**Expected ratings:** hard_skills 5 (5-axis + CAM + GD&T, current and deep),
experience_depth 4 (7+ years relevant, led tooling), domain_context 4 (FIZ
tooling ecosystem, speaks the language), progression 4 (promotion + internal
mobility), credentials 3 (diploma + safety cert, no degree). **Overall: 4.**

### Vignette B — Marginal B2B Sales (Job-Hopping)

A 27-year-old with six roles in four years: telemarketing (5 months), e-wallet
field sales (7 months), used-car sales (4 months), insurance agent (9 months),
FMCG distributor sales (6 months), and currently 3 months in SaaS cold-calling.
Strong spoken English and Bahasa Malaysia, confident pitch, quota attainment
once in six roles. Applied for a B2B SaaS account executive role in Klang
Valley.

**Expected ratings:** hard_skills 2 (selling skills present but shallow and
unstable), experience_depth 2 (1–2 years partial, no sustained ownership),
domain_context 2 (Klang Valley familiarity only, no B2B SaaS depth),
progression 1 (repeated <6-month tenures, no advancement), credentials 3
(SPM + sales training certs, bilingual). **Overall: 2.**

### Vignette C — Strong Skills, Weak Domain (Halo Trap)

A 29-year-old software engineer from India with 4 years at a Bangalore product
startup: React/TypeScript, distributed systems, CI/CD. Two roles, 2 years
each, one promotion to senior. Bachelor's in Computer Science. No Malaysia
experience, no FMCG/B2B-SaaS-domain exposure beyond generic e-commerce, and
10 months in the country. Applied for a senior frontend role at a Klang
Valley FMCG-tech firm.

**Expected ratings:** hard_skills 5 (current, deep, directly transferable),
experience_depth 3 (4 years solid but junior-level scope), domain_context 1
(no MY market or FMCG context), progression 3 (promotion but short history),
credentials 4 (degree + senior title). **Overall: 3.** The trap is rating 4–5
because skills are dazzling: the domain mismatch and short tenure cap the
overall rating.

## 4. Rating Discipline

### 4.1 Halo-Bias Control

- Score **all five dimensions** before forming the overall rating. The overall
  is a judgement informed by the dimensions, not a re-scoring of the one
  dimension you noticed first.
- If a dimension is genuinely unrateable from the resume, record the note
  "insufficient evidence" and use the **mid-anchor (3)** default, then flag it
  in the notes column — do not leave blanks.
- Beware the halo trap in Vignette C: one dazzling dimension cannot lift the
  overall if other dimensions are 1–2.

### 4.2 Central-Tendency Control

- Use the full 1–5 range. Anchors are defined for **2** and **4** precisely so
  that 3 is not the automatic fallback: a resume matching level 2 text gets a
  2, not a safe 3.
- If every resume in your batch ends up 3–4, re-read the 1, 2, and 5 anchors —
  the distribution is expected to be spread by construction of the cohort.

### 4.3 Order of Operations

1. Read the resume once fully.
2. Rate the five dimensions against the anchors (not against memory of other candidates).
3. Write the overall rating and a one-line justification in the notes.

## 5. Rating Sheet Instructions

| Column | Rule |
|---|---|
| profileResumeId | Copy exactly from the resume file name. |
| hard_skills … credentials | Integer 1–5; no fractions; no blanks. |
| overall | Integer 1–5, decided after all five dimensions. |
| notes | One line: the strongest and weakest dimension and the deciding factor. |

Submit the completed sheet (CSV or the provided template) to the panel lead;
scores are keyed by `profileResumeId`, never by name.

---

# Kit Penilai — Kohort MY (Bahasa Malaysia)

Panduan rakan kepada `rubric.ms.json` (skema `my-cohort-rubric/1`).

## 1. Tujuan

Kohort ini mengukur konsistensi penilai dan sistem AI dalam menyusun resume
yang sama. Penilai mesti bersetuju tentang **makna setiap angka** sebelum
menilai. Kit ini menyelaraskan: (1) makna setiap penanda, (2) disiplin urutan
penilaian (dimensi dahulu, keseluruhan kemudian), (3) penentukuran dengan kes
latihan sebelum panel sebenar.

## 2. Bahan

- Rubrik JSON (EN atau MS, pilihan anda) — satu-satunya rujukan pemarkahan.
- Satu resume bagi setiap calon (sintetik, sifar PII — nama sebenar tidak pernah muncul).
- Borang penilaian: satu baris bagi setiap calon, lima lajur dimensi + lajur keseluruhan + nota.

## 3. Penentukuran Rangka Rujukan (FoR)

Sebelum menilai panel, nilai tiga vignet latihan di bawah, kemudian bandingkan
dengan maklum balas penentukuran. Bincangkan sebarang perbezaan dengan ketua
panel sehingga penanda pasukan selari. **Jangan sesekali menilai panel sebenar
sebelum langkah ini selesai.**

### Vignet A — Jurutera CNC Kuat (FIZ Bayan Lepas)

Calon berumur 34 tahun dengan 9 tahun di sebuah firma alat semikonduktor Pulau
Pinang: pengaturcara/juruteknik mesin CNC → juruteknik kanan → ketua alat.
Mengendalikan pengilangan 5-paksi, pengaturcaraan CAM (Mastercam), GD&T, dan
pemeriksaan artikel pertama. Diploma Kejuruteraan Mekanikal dari politeknik
temptan (UiTM), serta sijil keselamatan OSHA/KKP. Tempoh perkhidmatan 3+ tahun
bagi setiap peranan, satu pindahan dalaman, tiada jurang. Dwibahasa EN/BM,
menulis laporan dalam bahasa Inggeris. Memohon peranan pengaturcaraan CNC di
sebuah kedai alat Bayan Lepas yang lain.

**Jangkaan markah:** kemahiran_keras 5 (5-paksi + CAM + GD&T, terkini dan
mendalam), kedalaman_pengalaman 4 (7+ tahun berkaitan, mengetuai alat),
konteks_domain 4 (ekosistem alat FIZ, fasih bahasa industri), kemajuan 4
(kenaikan pangkat + mobiliti dalaman), kelayakan 3 (diploma + sijil
keselamatan, tiada ijazah). **Keseluruhan: 4.**

### Vignet B — Jualan B2B Sempadan (Kerap Bertukar Kerja)

Calon berumur 27 tahun dengan enam peranan dalam empat tahun: telemarketing (5
bulan), jualan lapangan e-dompet (7 bulan), jualan kereta terpakai (4 bulan),
ejen insurans (9 bulan), jualan pengedar FMCG (6 bulan), dan kini 3 bulan
panggilan sejuk SaaS. Fasih berbahasa Inggeris dan Bahasa Malaysia, gaya
jualan yakin, mencapai kuota sekali dalam enam peranan. Memohon peranan
eksekutif akaun B2B SaaS di Lembah Klang.

**Jangkaan markah:** kemahiran_keras 2 (kemahiran jualan ada tetapi cetek dan
tidak stabil), kedalaman_pengalaman 2 (1–2 tahun separa, tiada pemilikan
berterusan), konteks_domain 2 (kebiasaan Lembah Klang sahaja, tiada kedalaman
B2B SaaS), kemajuan 1 (tempoh <6 bulan berulang, tiada kemajuan), kelayakan 3
(SPM + sijil latihan jualan, dwibahasa). **Keseluruhan: 2.**

### Vignet C — Kemahiran Kuat, Domain Lemah (Perangkap Halo)

Jurutera perisian berumur 29 tahun dari India dengan 4 tahun di sebuah
syarikat permulaan produk Bangalore: React/TypeScript, sistem teragih, CI/CD.
Dua peranan, 2 tahun setiap satu, satu kenaikan pangkat ke senior. Ijazah
Sarjana Muda Sains Komputer. Tiada pengalaman Malaysia, tiada pendedahan
domain FMCG/B2B-SaaS selain e-dagang generik, dan 10 bulan di negara ini.
Memohon peranan hadapan senior di sebuah firma FMCG-teknologi Lembah Klang.

**Jangkaan markah:** kemahiran_keras 5 (terkini, mendalam, boleh dipindah
terus), kedalaman_pengalaman 3 (4 tahun kukuh tetapi skop peringkat junior),
konteks_domain 1 (tiada konteks pasaran MY atau FMCG), kemajuan 3 (kenaikan
pangkat tetapi sejarah pendek), kelayakan 4 (ijazah + jawatan senior).
**Keseluruhan: 3.** Perangkapnya ialah memberi 4–5 kerana kemahiran memukau:
ketidakpadanan domain dan tempoh pendek mengehadkan markah keseluruhan.

## 4. Disiplin Penilaian

### 4.1 Kawalan Kesan Halo

- Nilaikan **kesemua lima dimensi** sebelum membentuk markah keseluruhan.
  Markah keseluruhan ialah pertimbangan berdasarkan dimensi, bukan penilaian
  semula satu dimensi yang pertama anda perasan.
- Jika sesuatu dimensi benar-benar tidak boleh dinilai daripada resume, catat
  nota "bukti tidak mencukupi" dan gunakan penanda tengah (3) sebagai lalai,
  kemudian tandakan dalam lajur nota — jangan biarkan kosong.
- Berhati-hati dengan perangkap halo dalam Vignet C: satu dimensi yang
  cemerlang tidak boleh menaikkan markah keseluruhan jika dimensi lain 1–2.

### 4.2 Kawalan Kecenderungan Tengah

- Gunakan julat penuh 1–5. Penanda ditakrifkan untuk tahap **2** dan **4**
  supaya 3 bukan pilihan lalai automatik: resume yang sepadan dengan teks
  tahap 2 mendapat 2, bukan 3 yang selamat.
- Jika semua resume dalam kumpulan anda berakhir 3–4, baca semula penanda
  1, 2, dan 5 — taburan dijangka tersebar mengikut reka bentuk kohort.

### 4.3 Urutan Tindakan

1. Baca resume sekali sepenuhnya.
2. Nilaikan lima dimensi berdasarkan penanda (bukan berdasarkan ingatan calon lain).
3. Tulis markah keseluruhan dan satu baris justifikasi dalam nota.

## 5. Arahan Borang Penilaian

| Lajur | Peraturan |
|---|---|
| profileResumeId | Salin tepat daripada nama fail resume. |
| hard_skills … credentials | Integer 1–5; tiada pecahan; tiada kosong. |
| overall | Integer 1–5, diputuskan selepas kelima-lima dimensi. |
| notes | Satu baris: dimensi terkuat dan terlemah serta faktor penentu. |

Serahkan borang lengkap (CSV atau templat yang disediakan) kepada ketua panel;
markah dipautkan melalui `profileResumeId`, bukan nama.
