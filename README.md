# TrackForge

**TrackForge** is a local plugin for Disguise Designer. It imports CSV or Excel `.xlsx` track lists, previews the changes, and creates tracks or updates the timecode (TC) tag on existing tracks.

**Ready-to-install release:** [TrackForge-v0.1.0.zip](./release/TrackForge-v0.1.0.zip)

## GitHub release and source

The GitHub release ZIP contains the ready-to-install plugin folder. Extract it and copy the included `TrackForge` folder to the project's `plugins` folder. The GitHub repository also includes the plugin source under `packages/plugins/TrackForge`.

TrackForge source is a plugin package for `d3-plugin-toolkit`; build it from that toolkit workspace with `npm run build --workspace=trackforge`. The resulting files are written to the package's `dist` folder.

## Installation

1. Close Disguise Designer before installing or replacing plugin files.
2. Copy the contents of this distribution folder into the project's plugin folder, for example:

   ```text
   <project folder>\plugins\TrackForge\
   ```

3. Confirm that `d3plugin.json`, `index.html`, `icon.png`, `icon.svg`, and the `assets` folder are directly inside `TrackForge`.
4. Reopen the project in Designer and launch TrackForge from the plugin list.

Keep a backup of an existing plugin folder before replacing it. The plugin folder location can vary by project setup; if TrackForge does not appear, check that the manifest is in the folder Designer scans for plugins.

## Usage

1. Prepare a `.csv` or `.xlsx` file and choose **Choose file** in TrackForge.
2. Confirm the automatically detected **Track name column** and **Timecode column**, or select the correct columns manually. Choose **No timecode — create tracks only** if the file has no TC column.
3. Review the report. Edit the proposed track name or timecode if needed.
4. Select individual rows, or use the checkbox in the table header to select all valid operations.
5. Choose **Apply changes** and review the result shown for each row.

Rows with invalid names or timecodes cannot be selected. Tracks whose TC tag already matches the imported value are marked as up to date and are not changed. In track-only mode, only new tracks can be selected; existing tracks are left unchanged.

## Input file format

TrackForge looks for a header row within the first 20 rows. It supports comma-, semicolon-, and tab-delimited CSV files. For Excel, it uses the first worksheet containing a usable header row.

Common English and Italian headings are detected automatically (case, spaces, and line breaks do not matter):

| Data | Example headings |
| --- | --- |
| Track name | `Name`, `Song`, `Song Name`, `Track`, `Track Name`, `Segment`, `Title & Dur`, `Cue`, `Traccia`, `Nome traccia`, `Canzone`, `Nome canzone`, `Titolo`, `Titolo brano`, `Nome brano` |
| Timecode | `TC`, `TC Start`, `Start`, `Start Time`, `Timecode`, `Timecode Start`, `LTC`, `Ora inizio`, `Timecode inizio` |

If a heading is missing or uses a different name, the file's columns are still shown and can be mapped manually. For CSV files without a header that consist of numbered rows (number in the first column and name in the second), TrackForge keeps the first row as data and suggests the second column for track names.

Timecodes may use `H:MM:SS:FF`, `HH:MM:SS:FF`, `H:MM:SS`, or `HH:MM:SS`. If frames are omitted, TrackForge uses `00`.

```text
01:23:45:12
01:23:45       -> 01:23:45:00
1:23:45:12
```

For multi-row Excel headings, TrackForge prefers the more specific data-table headings (for example, `TITLE & DUR` and `TC START`) over an earlier general heading. The track name is derived from the selected name value. TrackForge removes the file extension, trailing duration lines such as `dur 4'31''`, and recognized technical suffixes such as `_REF MIX`, `_L_MIX`, `_OPEN##_MUSIC`, and trailing `[chan ...]` data.

## Track behavior

- A new track is created with an empty first section lasting one minute; the TC tag is placed in the second section.
- In track-only mode, a new track is created with the same section layout but no TC tag. Existing tracks are not modified.
- An existing track is not recreated. Its TC tag is updated only if the imported value differs.
- If an existing track is missing the minimum section structure, TrackForge attempts to repair it before writing the tag.
- TrackForge checks the resulting section and tag state and reports an error if Designer does not confirm the operation.

Test on a copy of the project before applying a large or important track list.

## Troubleshooting

- **Designer not connected:** Open TrackForge from the running Designer project and confirm that the project is loaded.
- **TrackForge is not listed:** Check the plugin folder location, `d3plugin.json`, and the `assets` folder. Restart or refresh Designer's plugin list after installing.
- **The Launcher shows a generic icon:** Check that `icon.svg` is next to `d3plugin.json`, then restart or refresh the Launcher.
- **No preview appears:** Choose a track name column and either a timecode column or **No timecode — create tracks only**. Ensure the file includes a header row and data rows.
- **Invalid timecode:** Use `H:MM:SS`, `HH:MM:SS`, `H:MM:SS:FF`, or `HH:MM:SS:FF`; minutes and seconds must be between `00` and `59`.
- **An operation fails:** Read the row's status message and verify that the project is writable and Designer remains connected.

---

Created by Stefano Petroni

---

# TrackForge (Italiano)

**TrackForge** è un plugin locale per Disguise Designer. Importa scalette CSV o Excel `.xlsx`, mostra un'anteprima delle modifiche e crea le track oppure aggiorna il tag timecode (TC) delle track esistenti.

**Release pronta per l'installazione:** [TrackForge-v0.1.0.zip](./release/TrackForge-v0.1.0.zip)

## Release GitHub e sorgenti

Lo ZIP della release GitHub contiene la cartella plugin pronta per l'installazione. Estrailo e copia la cartella `TrackForge` inclusa nella cartella `plugins` del progetto. Il repository GitHub include anche il codice sorgente del plugin in `packages/plugins/TrackForge`.

Il sorgente TrackForge è un pacchetto per `d3-plugin-toolkit`; per compilarlo, usa il workspace del toolkit con `npm run build --workspace=trackforge`. I file risultanti vengono scritti nella cartella `dist` del pacchetto.

## Installazione

1. Chiudi Disguise Designer prima di installare o sostituire i file del plugin.
2. Copia il contenuto di questa cartella di distribuzione nella cartella plugin del progetto, ad esempio:

   ```text
   <cartella progetto>\plugins\TrackForge\
   ```

3. Verifica che `d3plugin.json`, `index.html`, `icon.png`, `icon.svg` e la cartella `assets` si trovino direttamente dentro `TrackForge`.
4. Riapri il progetto in Designer e avvia TrackForge dall'elenco dei plugin.

Prima di sostituire un plugin già installato, conserva una copia di backup della cartella. Il percorso dei plugin può variare in base alla configurazione del progetto; se TrackForge non compare, verifica che il manifest si trovi nella cartella esaminata da Designer.

## Utilizzo

1. Prepara un file `.csv` o `.xlsx` e seleziona **Choose file** in TrackForge.
2. Verifica le colonne rilevate automaticamente per **Track name column** e **Timecode column**, oppure seleziona manualmente quelle corrette. Se il file non contiene una colonna TC, scegli **No timecode — create tracks only**.
3. Controlla il report. Se necessario, modifica il nome della track o il timecode proposto.
4. Seleziona le singole righe oppure usa la casella nell'intestazione della tabella per selezionare tutte le operazioni valide.
5. Premi **Apply changes** e controlla l'esito mostrato per ogni riga.

Le righe con nomi o timecode non validi non sono selezionabili. Le track con tag TC già corrispondente vengono indicate come aggiornate e non vengono modificate. Nella modalità senza TC sono selezionabili solo le nuove track; quelle esistenti restano invariate.

## Formato del file

TrackForge cerca una riga di intestazione nelle prime 20 righe. Nei CSV supporta i separatori virgola, punto e virgola e tabulazione. In Excel usa il primo foglio con una riga di intestazione utilizzabile.

Le intestazioni inglesi e italiane più comuni vengono rilevate automaticamente (maiuscole, spazi e ritorni a capo non influiscono):

| Dato | Esempi di intestazione |
| --- | --- |
| Nome track | `Name`, `Song`, `Song Name`, `Track`, `Track Name`, `Segment`, `Title & Dur`, `Cue`, `Traccia`, `Nome traccia`, `Canzone`, `Nome canzone`, `Titolo`, `Titolo brano`, `Nome brano` |
| Timecode | `TC`, `TC Start`, `Start`, `Start Time`, `Timecode`, `Timecode Start`, `LTC`, `Ora inizio`, `Timecode inizio` |

Se un'intestazione manca o ha un nome diverso, le colonne del file vengono comunque mostrate e possono essere associate manualmente. Nei CSV senza intestazioni con righe numerate (numero nella prima colonna e nome nella seconda), TrackForge conserva anche la prima riga come dato e suggerisce la seconda colonna per il nome track.

Il timecode può essere in formato `H:MM:SS:FF`, `HH:MM:SS:FF`, `H:MM:SS` oppure `HH:MM:SS`. Se i frame non sono indicati, TrackForge imposta `00`.

```text
01:23:45:12
01:23:45       -> 01:23:45:00
1:23:45:12
```

Per le intestazioni Excel su più righe, TrackForge preferisce le intestazioni più specifiche della tabella (ad esempio `TITLE & DUR` e `TC START`) rispetto a un'intestazione generale precedente. Il nome della track deriva dal valore selezionato. TrackForge rimuove l'estensione del file, le righe finali di durata come `dur 4'31''` e le terminazioni tecniche riconosciute, ad esempio `_REF MIX`, `_L_MIX`, `_OPEN##_MUSIC` e i dati finali `[chan ...]`.

## Comportamento delle track

- Una nuova track viene creata con una prima section vuota della durata di un minuto; il tag TC viene collocato nella seconda section.
- Nella modalità senza TC, la nuova track mantiene la stessa struttura delle section ma non riceve alcun tag TC. Le track esistenti non vengono modificate.
- Una track esistente non viene ricreata. Il tag TC viene aggiornato solo se il valore importato è diverso.
- Se a una track esistente manca la struttura minima delle section, TrackForge prova a ripristinarla prima di scrivere il tag.
- TrackForge verifica la struttura e il tag risultanti e segnala un errore se Designer non conferma l'operazione.

Prima di applicare una scaletta importante, esegui una prova su una copia del progetto.

## Risoluzione dei problemi

- **Designer non connesso:** apri TrackForge dal progetto Designer in esecuzione e verifica che il progetto sia caricato.
- **TrackForge non compare:** controlla il percorso della cartella plugin, `d3plugin.json` e la presenza della cartella `assets`.
- **L'anteprima non appare:** seleziona la colonna del nome track e una colonna timecode oppure **No timecode — create tracks only**. Verifica che il file contenga una riga di intestazione e righe di dati.
- **Timecode non valido:** usa `H:MM:SS`, `HH:MM:SS`, `H:MM:SS:FF` oppure `HH:MM:SS:FF`; minuti e secondi devono essere compresi tra `00` e `59`.
- **Un'operazione non riesce:** leggi il messaggio di stato della riga e verifica che il progetto sia scrivibile e Designer sia ancora connesso.

---

Creato da Stefano Petroni
