import { describe, expect, it } from 'vitest'
import * as XLSX from '@e965/xlsx'
import { cleanSongName, normalizeTimecode, parseCsvText, parseXlsxBuffer, trackSlug } from './importParser'

describe('TrackForge import parser', () => {
  it('detects English headings, reads CSV rows, and preserves source row numbers', () => {
    const result = parseCsvText([
      '#,Name,Start,End',
      'R1,SHORT CAMILLA.WAV,00:00:00:00,00:02:14:19',
      'R2,IL COMICO new intro_REF MIX.WAV,00:19:34:20,00:25:54:16',
      'R3,"NESSUNO VUOLE ESSERE ROBIN,_L_MIX-R_SMPTE [chan 1]_1.WAV",02:10:02:01,02:15:51:14',
    ].join('\r\n'))

    expect(result.suggestedTitleColumn).toBe(1)
    expect(result.suggestedTimecodeColumn).toBe(2)
    expect(result.records.map(record => record.sourceRow)).toEqual([2, 3, 4])
    expect(result.records.map(record => cleanSongName(record.values[1]))).toEqual([
      'SHORT CAMILLA',
      'IL COMICO new intro',
      'NESSUNO VUOLE ESSERE ROBIN',
    ])
    expect(normalizeTimecode(result.records[0].values[2])).toBe('00:00:00:00')
  })

  it('detects Italian headings in semicolon CSV after introductory rows', () => {
    const result = parseCsvText([
      'Colonna1.1;Colonna1.2;Colonna1.3',
      '#;Nome canzone;TC Start',
      'R1;s’inkazza;09:00:00',
    ].join('\n'))

    expect(result.columns.map(column => column.label)).toEqual(['#', 'Nome canzone', 'TC Start'])
    expect(result.suggestedTitleColumn).toBe(1)
    expect(result.suggestedTimecodeColumn).toBe(2)
    expect(normalizeTimecode(result.records[0].values[2])).toBe('09:00:00:00')
  })

  it('continues delimiter detection past an unrecognized preamble row', () => {
    const result = parseCsvText([
      'Colonna1.1;Colonna1.2;Colonna1.3;Colonna1.4;Colonna1.5;Colonna1.6',
      '#;Name;Start;End;Length;Color',
      "R1;s'inkazza;09:00:00:00;09:01:23:16;00:01:23:16;FD90FF",
      "R2;Hanno ucciso l'uomo ragno;01:10:38:23;01:15:23:10;00:04:44:12;D0EF7F",
    ].join('\r\n'))

    expect(result.columns.map(column => column.label)).toEqual([
      '#', 'Name', 'Start', 'End', 'Length', 'Color',
    ])
    expect(result.suggestedTitleColumn).toBe(1)
    expect(result.suggestedTimecodeColumn).toBe(2)
    expect(result.records).toHaveLength(2)
    expect(result.records[1].values[1]).toBe("Hanno ucciso l'uomo ragno")
  })

  it('keeps name-only CSV columns available when the header has no timecode', () => {
    const result = parseCsvText([
      'Export title;Pezzali regions',
      '#;Name;Color',
      'R1;Gli anni;49828B',
      'R2;Sei un mito;ACD834',
    ].join('\n'))

    expect(result.columns.map(column => column.label)).toEqual(['#', 'Name', 'Color'])
    expect(result.suggestedTitleColumn).toBe(1)
    expect(result.suggestedTimecodeColumn).toBeNull()
    expect(result.records).toHaveLength(2)
    expect(result.records[0].values[1]).toBe('Gli anni')
  })

  it('imports numbered CSV lists without headers and keeps the first data row', () => {
    const result = parseCsvText([
      '3;IL COMICO',
      '2;DICONO DI ME + PADREMADRE',
      '21;50 SPECIAL',
    ].join('\n'))

    expect(result.suggestedTitleColumn).toBe(1)
    expect(result.suggestedTimecodeColumn).toBeNull()
    expect(result.records.map(record => record.sourceRow)).toEqual([1, 2, 3])
    expect(result.records[0].values).toEqual(['3', 'IL COMICO'])
    expect(result.records[0].values[result.suggestedTitleColumn!]).toBe('IL COMICO')
  })

  it('provides a header fallback so users can manually map unrecognized column names', () => {
    const result = parseCsvText([
      'ID,Program item,Start position',
      '1,Intro + l’allegria,00:10:00:00',
      '2,Che meraviglia sei,A MANO',
    ].join('\n'))

    expect(result.suggestedTitleColumn).toBeNull()
    expect(result.suggestedTimecodeColumn).toBeNull()
    expect(result.columns.map(column => column.label)).toEqual(['ID', 'Program item', 'Start position'])
    expect(result.records[0].values[1]).toBe('Intro + l’allegria')
    expect(normalizeTimecode(result.records[0].values[2])).toBe('00:10:00:00')
    expect(normalizeTimecode(result.records[1].values[2])).toBeNull()
  })

  it('prefers a complete known header over an earlier partial match', () => {
    const result = parseCsvText([
      'Start,ID,Notes',
      'Name,TC Start,Other',
      'Song A,00:20:00,extra',
    ].join('\n'))

    expect(result.records[0].sourceRow).toBe(3)
    expect(result.suggestedTitleColumn).toBe(0)
    expect(result.suggestedTimecodeColumn).toBe(1)
  })

  it('prefers detailed rundown headers and recognizes segment/LTC columns', () => {
    const result = parseCsvText([
      'BLOCK,,ITEM,TIME CODE,SONG',
      '','','','','',
      'BLOCK,,ITEM,TITLE & DUR,TC START',
      'ONE,,1,"INTRO + IL COMICO\n\ndur 6\' 28\'\'",0:19:34:21',
    ].join('\n'))

    expect(result.columns[result.suggestedTitleColumn!].label).toBe('TITLE & DUR')
    expect(result.columns[result.suggestedTimecodeColumn!].label).toBe('TC START')
    expect(cleanSongName(result.records[0].values[result.suggestedTitleColumn!]))
      .toBe('INTRO + IL COMICO')

    const runningOrder = parseCsvText([
      'SEGMENT,ACT,HRS,TIMING,LTC,ACTION',
      'INTRO SONG,1,20:45:00,0:03:38,0:10:00:00,Description',
    ].join('\n'))
    expect(runningOrder.suggestedTitleColumn).toBe(0)
    expect(runningOrder.suggestedTimecodeColumn).toBe(4)
    expect(normalizeTimecode(runningOrder.records[0].values[4])).toBe('0:10:00:00')
  })

  it('finds an Excel header row and exposes all columns for mapping', () => {
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([
      ['SPONSOR', '4 Volte PNG x 1 MIN / 1 volta SUBARU'],
      ['', 'Titolo brano', '', 'Timecode'],
      [1, "Intro + l'allegria", 'TIMECODE', '00:10:00:00'],
      [5.5, 'Che meraviglia sei', 'live + fiori', 'A MANO'],
    ])
    XLSX.utils.book_append_sheet(workbook, sheet, 'Foglio1')
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const result = parseXlsxBuffer(buffer)

    expect(result.sourceSheet).toBe('Foglio1')
    expect(result.suggestedTitleColumn).toBe(1)
    expect(result.suggestedTimecodeColumn).toBe(3)
    expect(result.records[0].values[1]).toBe("Intro + l'allegria")
    expect(result.records[1].values[3]).toBe('A MANO')
  })

  it('normalizes timecodes and creates safe case-insensitive track paths', () => {
    expect(normalizeTimecode('01:02:03')).toBe('01:02:03:00')
    expect(normalizeTimecode('01:02:03:24')).toBe('01:02:03:24')
    expect(normalizeTimecode('1:02:03:24')).toBe('1:02:03:24')
    expect(normalizeTimecode('01:62:03')).toBeNull()
    expect(cleanSongName("INTRO + IL COMICO\n\ndur 6' 28''")).toBe('INTRO + IL COMICO')
    expect(cleanSongName("INTRO + LOST IN THE WEEKEND\ndu5'21''")).toBe('INTRO + LOST IN THE WEEKEND')
    expect(trackSlug('L’universo tranne noi')).toBe('l-universo-tranne-noi')
    expect(cleanSongName('BUON VIAGGIO_OPEN26_MUSIC (L) + TC (R)_140526 [chan 1]_1.WAV'))
      .toBe('BUON VIAGGIO')
  })
})
