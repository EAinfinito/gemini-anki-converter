import React, { useState } from 'react';
import { Download, AlertCircle, CheckCircle, Edit2, Trash2, Plus, Copy, Eye, Code } from 'lucide-react';

export interface Flashcard {
  front: string;
  back: string;
  type: 'Basic' | 'Cloze';
  include: boolean;
}

/**
 * Converts raw markdown and LaTeX into Anki-compatible single-line HTML for TSV import.
 * - Handles LaTeX arrows (\rightarrow, \leftarrow, etc.) and math wrappers ($...$)
 * - Converts markdown bullet lines to clean HTML lines with proper indentation
 * - Converts bold (**text**) to <b>text</b> and italics (*text*) to <i>text</i>
 * - Converts newlines into <br> tags so cards fit on a single row in TSV
 * - Optionally wraps in <div style="text-align: left;">...</div> for Anki alignment
 */
export const formatForAnki = (text: string, wrapLeftAlign: boolean = false): string => {
  if (!text) return '';
  let s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Replace LaTeX arrows and common math symbols
  s = s.replace(/\\rightarrow\b/g, '→');
  s = s.replace(/\\leftarrow\b/g, '←');
  s = s.replace(/\\leftrightarrow\b/g, '↔');
  s = s.replace(/\\to\b/g, '→');
  s = s.replace(/\\Rightarrow\b/g, '⇒');
  s = s.replace(/\\Leftarrow\b/g, '⇐');
  s = s.replace(/\\Leftrightarrow\b/g, '⇔');
  s = s.replace(/\\pm\b/g, '±');
  s = s.replace(/\\(?:leq|le)\b/g, '≤');
  s = s.replace(/\\(?:geq|ge)\b/g, '≥');
  s = s.replace(/\\(?:neq|ne)\b/g, '≠');
  s = s.replace(/\\approx\b/g, '≈');
  s = s.replace(/\\times\b/g, '×');
  s = s.replace(/\\div\b/g, '÷');

  // Clean common LaTeX wrapper macros like \text{...} or \mathbf{...}
  s = s.replace(/\\(?:text|mathbf|mathrm|mathit)\{([^}]+)\}/g, '$1');

  // Strip simple math wrappers $...$
  s = s.replace(/\$([^$\n]+)\$/g, '$1');

  // Normalize excessive blank lines (3+ to 2)
  s = s.replace(/\n{3,}/g, '\n\n');

  // Process line by line for bullet points and inline formatting
  const lines = s.split('\n');
  const formattedLines = lines.map((line) => {
    // Convert markdown bullet lines (*, -, +) into clean HTML lines:
    // - Top-level bullets (0-1 leading spaces): •
    // - Indented/nested sub-bullets (2+ leading spaces): &nbsp;&nbsp;&nbsp;&nbsp;◦
    const bulletMatch = line.match(/^(\s*)([*+-])\s+(.*)$/);
    let processed = line;
    if (bulletMatch) {
      const leadingSpaces = bulletMatch[1].length;
      const rest = bulletMatch[3];
      if (leadingSpaces >= 2) {
        const indentLevel = Math.max(1, Math.floor(leadingSpaces / 2));
        const spaces = '&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(indentLevel);
        processed = `${spaces}◦ ${rest}`;
      } else {
        processed = `• ${rest}`;
      }
    }

    // Convert bold **text** or __text__ to <b>text</b>
    processed = processed.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    processed = processed.replace(/__(.+?)__/g, '<b>$1</b>');

    // Convert italics *text* or _text_ to <i>text</i>
    // (Asterisks used as bullets at the start of a line were already replaced by • or ◦ above)
    processed = processed.replace(/(?<!\*)\*([^*\s\n](?:[^*\n]*?[^*\s\n])?)\*(?!\*)/g, '<i>$1</i>');
    processed = processed.replace(/(?<=^|[\s(])_([^_\s\n](?:[^_\n]*?[^_\s\n])?)_(?=[\s).,;:!?]|$)/g, '<i>$1</i>');

    return processed;
  });

  // Convert newlines into <br> tags
  let html = formattedLines.join('<br>');

  // Protect TSV delimiter: replace literal tabs with non-breaking spaces
  html = html.replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');

  // Strip leading and trailing <br> tags
  html = html.replace(/^(?:<br\s*\/?>)+|(?:<br\s*\/?>)+$/gi, '');

  if (wrapLeftAlign && html) {
    html = `<div style="text-align: left;">${html}</div>`;
  }

  return html;
};

export default function AnkiFlashcardConverter() {
  const [input, setInput] = useState('');
  const [deckName, setDeckName] = useState('');
  const [tags, setTags] = useState('');
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editFront, setEditFront] = useState('');
  const [editBack, setEditBack] = useState('');
  const [editType, setEditType] = useState<'Basic' | 'Cloze'>('Basic');
  const [viewMode, setViewMode] = useState<'formatted' | 'raw'>('formatted');
  const [copiedType, setCopiedType] = useState<'Basic' | 'Cloze' | null>(null);

  const parseFlashcards = () => {
    if (!input.trim()) {
      alert('Please paste flashcards to parse!');
      return;
    }

    const lines = input.split(/\r?\n/);
    const parsedCards: Flashcard[] = [];
    let currentCard: { front: string; back: string; type: 'Basic' | 'Cloze' } = {
      front: '',
      back: '',
      type: 'Basic',
    };
    let currentField: 'front' | 'back' | null = null;
    let usedQuestionMarker = false;

    const pushCurrentCard = () => {
      const front = currentCard.front.trim();
      const back = currentCard.back.trim();
      if (front || back) {
        let type = currentCard.type;
        // Auto-detect cloze deletions {{c1::...}}
        if (/\{\{c\d+::/i.test(front) || /\{\{c\d+::/i.test(back)) {
          type = 'Cloze';
        }
        parsedCards.push({
          front,
          back,
          type,
          include: true,
        });
      }
      currentCard = { front: '', back: '', type: 'Basic' };
      currentField = null;
      usedQuestionMarker = false;
    };

    const hrRegex = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
    // Match markers with optional leading markdown/numbering (*, -, #, 1., etc.) and wrapping bold/italic
    const markerRegex =
      /^[\s*#_>-]*(?:\d+[.)]\s*)?[\s*#_>-]*(CARD\s*TYPE|FRONT|QUESTION|BACK|ANSWER|EXTRA|TEXT|CLOZE)[*_]*\s*[:：\-–—]\s*[*_]*\s*(.*)$/i;

    for (const rawLine of lines) {
      if (hrRegex.test(rawLine)) {
        pushCurrentCard();
        continue;
      }

      const match = rawLine.match(markerRegex);
      let isMarker = false;

      if (match) {
        const keyword = match[1].toUpperCase().replace(/\s+/g, ' ');
        let content = match[2] || '';

        // Clean trailing bold if marker had wrapping bold like **Front: ...**
        if (rawLine.trim().startsWith('**') && content.endsWith('**') && !content.startsWith('**')) {
          content = content.slice(0, -2).trim();
        }

        // Edge case: "Answer:" should only be treated as a field marker if the card used "Question:"
        // and we are currently on the front field. If we are already inside a BACK block or it is a bullet
        // point (e.g. `* **Answer:** ...`), keep it as normal bullet content!
        if (keyword === 'ANSWER') {
          const isBullet = /^\s*[*+-]\s+/.test(rawLine);
          if (usedQuestionMarker && currentField === 'front' && !isBullet) {
            isMarker = true;
            currentField = 'back';
            currentCard.back = content;
          } else {
            // Keep as normal content inside current field (e.g., Back)
            isMarker = false;
          }
        } else if (keyword === 'CARD TYPE') {
          isMarker = true;
          if (currentCard.front.trim() || currentCard.back.trim()) {
            pushCurrentCard();
          }
          currentCard.type = content.toLowerCase().includes('cloze') ? 'Cloze' : 'Basic';
          currentField = null;
        } else if (keyword === 'FRONT' || keyword === 'QUESTION') {
          isMarker = true;
          if (currentCard.front.trim() || currentCard.back.trim()) {
            pushCurrentCard();
          }
          usedQuestionMarker = keyword === 'QUESTION';
          currentField = 'front';
          currentCard.front = content;
        } else if (keyword === 'BACK' || keyword === 'EXTRA') {
          isMarker = true;
          currentField = 'back';
          currentCard.back = content;
        } else if (keyword === 'TEXT' || keyword === 'CLOZE') {
          isMarker = true;
          if (currentCard.front.trim() || currentCard.back.trim()) {
            pushCurrentCard();
          }
          currentCard.type = 'Cloze';
          currentField = 'front';
          currentCard.front = content;
        }
      }

      if (!isMarker) {
        // Content lines: preserve exact indentation and line breaks
        if (currentField) {
          if (!currentCard[currentField]) {
            if (rawLine.trim() !== '') {
              currentCard[currentField] = rawLine;
            }
          } else {
            currentCard[currentField] += '\n' + rawLine;
          }
        } else if (currentCard.type === 'Cloze' && !currentCard.front && rawLine.trim() !== '') {
          currentField = 'front';
          currentCard.front = rawLine;
        } else if (/\{\{c\d+::/i.test(rawLine)) {
          if (currentCard.front.trim() || currentCard.back.trim()) {
            pushCurrentCard();
          }
          currentCard.type = 'Cloze';
          currentField = 'front';
          currentCard.front = rawLine;
        }
      }
    }

    pushCurrentCard();

    if (parsedCards.length === 0) {
      alert('Could not find any flashcards. Please verify the markers (e.g., Front: ... Back: ... or Text: ...).');
      return;
    }

    setCards(parsedCards);
  };

  const toggleCard = (index: number) => {
    setCards(cards.map((card, i) => (i === index ? { ...card, include: !card.include } : card)));
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditFront(cards[index].front);
    setEditBack(cards[index].back);
    setEditType(cards[index].type);
  };

  const saveEdit = () => {
    if (editingIndex === null) return;
    setCards(
      cards.map((card, i) =>
        i === editingIndex
          ? {
              ...card,
              front: editFront,
              back: editBack,
              type: editType,
            }
          : card
      )
    );
    setEditingIndex(null);
  };

  const deleteCard = (index: number) => {
    setCards(cards.filter((_, i) => i !== index));
  };

  const addNewCard = () => {
    const newCard: Flashcard = {
      front: 'New question',
      back: 'New answer',
      type: 'Basic',
      include: true,
    };
    setCards([...cards, newCard]);
    setEditingIndex(cards.length);
    setEditFront('New question');
    setEditBack('New answer');
    setEditType('Basic');
  };

  /**
   * Generates Anki-compatible TSV output with native headers (#separator:tab, #html:true)
   * for either 'Basic' or 'Cloze' note types.
   * Wraps the Back field in <div style="text-align: left;">...</div> to preserve left alignment in Anki.
   */
  const generateTSV = (type: 'Basic' | 'Cloze'): string | null => {
    const includedCards = cards.filter((card) => card.include && card.type === type);
    if (includedCards.length === 0) {
      alert(`No ${type} cards selected for export!`);
      return null;
    }

    // Native Anki file headers
    const header = '#separator:tab\n#html:true\n';
    const cleanTags = (tags || '').trim().replace(/\t/g, ' ');

    const rows = includedCards.map((card) => {
      if (type === 'Basic') {
        const frontHtml = formatForAnki(card.front);
        const backHtml = formatForAnki(card.back, true); // wrapLeftAlign: true for Anki
        return `${frontHtml}\t${backHtml}\t${cleanTags}`;
      } else {
        const textHtml = formatForAnki(card.front || card.back, true); // wrapLeftAlign: true for Anki
        return `${textHtml}\t${cleanTags}`;
      }
    });

    return header + rows.join('\n') + '\n';
  };

  const copyCards = (type: 'Basic' | 'Cloze') => {
    const tsv = generateTSV(type);
    if (!tsv) return;

    navigator.clipboard.writeText(tsv);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 3000);
    alert(
      `Copied ${type} cards to clipboard! ✓\n\nReady to import into Anki with note type "${
        type === 'Basic' ? 'Basic with Tags' : 'Cloze with Tags'
      }".`
    );
  };

  const downloadCards = (type: 'Basic' | 'Cloze') => {
    const tsv = generateTSV(type);
    if (!tsv) return;

    const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeDeck = deckName.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'anki';
    link.download = `${safeDeck}_${type.toLowerCase()}_cards.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const basicCount = cards.filter((c) => c.include && c.type === 'Basic').length;
  const clozeCount = cards.filter((c) => c.include && c.type === 'Cloze').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">AI Flashcard → Anki Converter</h1>
          <p className="text-gray-600 mb-6">
            Convert AI-generated markdown flashcards (ChatGPT, Gemini, Claude) to native Anki TSV with preserved bullet points, LaTeX arrows, and HTML formatting!
          </p>

          {/* Input Section */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                1. Paste AI Flashcards (Markdown / Text)
              </label>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Paste your flashcards here...\n\nExample:\n**Front:** What is photosynthesis?\n**Back:**\n* **Answer:** Plants use sunlight\n* **Memory Hook:** Photo = Light\n* $CO_2 + H_2O \\rightarrow Glucose + O_2$\n\n---\n\nCARD TYPE: Cloze\n**Text:** The capital of France is {{c1::Paris}}.`}
                className="w-full h-52 p-4 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all font-mono text-sm leading-relaxed"
                style={{ textAlign: 'left' }}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  2. Deck Name (e.g., UPSC::Sociology)
                </label>
                <input
                  type="text"
                  value={deckName}
                  onChange={(e) => setDeckName(e.target.value)}
                  placeholder="UPSC::Sociology"
                  className="w-full p-3 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  3. Tags (e.g., Polity::Article_14)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="Polity::Fundamental_Rights::Article_14"
                  className="w-full p-3 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all text-sm"
                />
              </div>
            </div>

            <button
              onClick={parseFlashcards}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition-colors shadow-md flex items-center justify-center gap-2"
            >
              4. Parse & Review Flashcards
            </button>
          </div>

          {/* Cards Display */}
          {cards.length > 0 && (
            <div className="border-t-2 border-gray-200 pt-6">
              <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-800">
                    Review Cards ({basicCount} Basic, {clozeCount} Cloze)
                  </h2>
                  <p className="text-xs text-gray-500">
                    Preview how cards render in Anki or switch to raw markdown mode.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {/* View Mode Toggle */}
                  <div className="inline-flex rounded-lg border border-gray-300 bg-gray-100 p-0.5 text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => setViewMode('formatted')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                        viewMode === 'formatted'
                          ? 'bg-white text-indigo-700 shadow-sm font-semibold'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      <Eye size={14} /> Formatted Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('raw')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                        viewMode === 'raw'
                          ? 'bg-white text-indigo-700 shadow-sm font-semibold'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      <Code size={14} /> Raw Markdown
                    </button>
                  </div>

                  <button
                    onClick={addNewCard}
                    className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors shadow-sm"
                  >
                    <Plus size={16} /> Add Card
                  </button>
                </div>
              </div>

              {/* Cards List */}
              <div className="space-y-3 mb-6 max-h-[30rem] overflow-y-auto pr-1">
                {cards.map((card, index) => (
                  <div
                    key={index}
                    className={`border-2 rounded-lg p-4 transition-all text-left ${
                      card.include ? 'border-green-300 bg-green-50/60' : 'border-gray-300 bg-gray-50 opacity-60'
                    }`}
                    style={{ textAlign: 'left' }}
                  >
                    {editingIndex === index ? (
                      <div className="space-y-3" style={{ textAlign: 'left' }}>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">Card Type:</label>
                          <select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value as 'Basic' | 'Cloze')}
                            className="w-full p-2 border border-gray-300 rounded text-sm bg-white"
                          >
                            <option value="Basic">Basic</option>
                            <option value="Cloze">Cloze</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 mb-1">
                            {editType === 'Basic' ? 'Front:' : 'Text (with {{c1::deletions}}):'}
                          </label>
                          <textarea
                            value={editFront}
                            onChange={(e) => setEditFront(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded font-mono text-sm leading-relaxed"
                            rows={editType === 'Basic' ? 3 : 4}
                            style={{ textAlign: 'left' }}
                          />
                        </div>
                        {editType === 'Basic' && (
                          <div>
                            <label className="block text-xs font-semibold text-gray-600 mb-1">Back:</label>
                            <textarea
                              value={editBack}
                              onChange={(e) => setEditBack(e.target.value)}
                              className="w-full p-2 border border-gray-300 rounded font-mono text-sm leading-relaxed"
                              rows={5}
                              style={{ textAlign: 'left' }}
                            />
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={saveEdit}
                            className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingIndex(null)}
                            className="bg-gray-400 hover:bg-gray-500 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={card.include}
                              onChange={() => toggleCard(index)}
                              className="w-5 h-5 cursor-pointer accent-green-600 rounded"
                            />
                            <span className="font-bold text-gray-700">Card {index + 1}</span>
                            <span
                              className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                                card.type === 'Cloze'
                                  ? 'bg-purple-100 text-purple-800 border border-purple-300'
                                  : 'bg-blue-100 text-blue-800 border border-blue-300'
                              }`}
                            >
                              {card.type}
                            </span>
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => startEdit(index)}
                              className="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 transition-colors"
                              title="Edit Card"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => deleteCard(index)}
                              className="text-red-600 hover:text-red-800 p-1 rounded hover:bg-red-50 transition-colors"
                              title="Delete Card"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>

                        {/* Card Content Display */}
                        <div className="space-y-2 text-sm text-left" style={{ textAlign: 'left' }}>
                          {card.type === 'Basic' ? (
                            <>
                              <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                                <span className="font-semibold text-indigo-700 shrink-0">Q:</span>
                                {viewMode === 'formatted' ? (
                                  <div
                                    className="text-gray-800 text-left leading-relaxed w-full"
                                    style={{ textAlign: 'left' }}
                                    dangerouslySetInnerHTML={{ __html: formatForAnki(card.front) }}
                                  />
                                ) : (
                                  <pre
                                    className="text-gray-800 text-left whitespace-pre-wrap font-sans text-sm leading-relaxed w-full"
                                    style={{ textAlign: 'left' }}
                                  >
                                    {card.front}
                                  </pre>
                                )}
                              </div>
                              <div className="flex flex-col sm:flex-row sm:items-start gap-2 pt-2 border-t border-gray-200/60">
                                <span className="font-semibold text-green-700 shrink-0">A:</span>
                                {viewMode === 'formatted' ? (
                                  <div
                                    className="text-gray-800 text-left leading-relaxed w-full"
                                    style={{ textAlign: 'left' }}
                                    dangerouslySetInnerHTML={{ __html: formatForAnki(card.back) }}
                                  />
                                ) : (
                                  <pre
                                    className="text-gray-800 text-left whitespace-pre-wrap font-sans text-sm leading-relaxed w-full"
                                    style={{ textAlign: 'left' }}
                                  >
                                    {card.back}
                                  </pre>
                                )}
                              </div>
                            </>
                          ) : (
                            <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                              <span className="font-semibold text-purple-700 shrink-0">Cloze:</span>
                              {viewMode === 'formatted' ? (
                                <div
                                  className="text-gray-800 text-left leading-relaxed w-full"
                                  style={{ textAlign: 'left' }}
                                  dangerouslySetInnerHTML={{ __html: formatForAnki(card.front || card.back) }}
                                />
                              ) : (
                                <pre
                                  className="text-gray-800 text-left whitespace-pre-wrap font-sans text-sm leading-relaxed w-full"
                                  style={{ textAlign: 'left' }}
                                >
                                  {card.front || card.back}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Upgraded Export Section with Separate Basic and Cloze Actions */}
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Basic Cards Export */}
                  <div
                    className={`p-4 rounded-lg border-2 text-left transition-all ${
                      basicCount > 0 ? 'border-blue-300 bg-blue-50/60' : 'border-gray-200 bg-gray-50 opacity-60'
                    }`}
                    style={{ textAlign: 'left' }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-gray-800 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block"></span>
                        Basic Cards ({basicCount})
                      </h3>
                      <span className="text-xs bg-blue-100 text-blue-800 font-medium px-2 py-0.5 rounded">
                        Note Type: Basic with Tags
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mb-4">
                      Exports with native Anki headers (<code>#separator:tab</code>, <code>#html:true</code>) and left-aligned container.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyCards('Basic')}
                        disabled={basicCount === 0}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold py-2.5 px-3 rounded-lg text-sm transition-colors shadow-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                      >
                        {copiedType === 'Basic' ? <CheckCircle size={16} /> : <Copy size={16} />}
                        {copiedType === 'Basic' ? 'Copied Basic!' : 'Copy Basic'}
                      </button>
                      <button
                        onClick={() => downloadCards('Basic')}
                        disabled={basicCount === 0}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 text-white font-semibold py-2.5 px-3 rounded-lg text-sm transition-colors shadow-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <Download size={16} /> Download Basic (.txt)
                      </button>
                    </div>
                  </div>

                  {/* Cloze Cards Export */}
                  <div
                    className={`p-4 rounded-lg border-2 text-left transition-all ${
                      clozeCount > 0 ? 'border-purple-300 bg-purple-50/60' : 'border-gray-200 bg-gray-50 opacity-60'
                    }`}
                    style={{ textAlign: 'left' }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-gray-800 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-purple-600 inline-block"></span>
                        Cloze Cards ({clozeCount})
                      </h3>
                      <span className="text-xs bg-purple-100 text-purple-800 font-medium px-2 py-0.5 rounded">
                        Note Type: Cloze with Tags
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mb-4">
                      Exports isolated Cloze cards with native headers. Eliminates the accidental <code># CLOZE CARDS</code> import header problem.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyCards('Cloze')}
                        disabled={clozeCount === 0}
                        className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white font-semibold py-2.5 px-3 rounded-lg text-sm transition-colors shadow-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                      >
                        {copiedType === 'Cloze' ? <CheckCircle size={16} /> : <Copy size={16} />}
                        {copiedType === 'Cloze' ? 'Copied Cloze!' : 'Copy Cloze'}
                      </button>
                      <button
                        onClick={() => downloadCards('Cloze')}
                        disabled={clozeCount === 0}
                        className="flex-1 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:bg-gray-300 text-white font-semibold py-2.5 px-3 rounded-lg text-sm transition-colors shadow-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <Download size={16} /> Download Cloze (.txt)
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Instructions Section */}
              <div className="mt-6 bg-amber-50 border-l-4 border-amber-500 p-4 rounded text-left" style={{ textAlign: 'left' }}>
                <h3 className="font-bold text-amber-800 mb-2 flex items-center gap-2">
                  <AlertCircle size={18} /> Setup & Import Instructions
                </h3>
                <div className="text-sm text-amber-900 space-y-4">
                  <div>
                    <p className="font-bold mb-2">📌 ONE-TIME SETUP (Do this once in Anki):</p>
                    <ol className="ml-4 list-decimal space-y-2">
                      <li>
                        <strong>Create "Basic with Tags" note type:</strong>
                        <ul className="ml-4 list-disc mt-1">
                          <li>Tools → Manage Note Types → Add</li>
                          <li>Choose "Basic" → Name it "Basic with Tags"</li>
                          <li>Click Fields → Add field "Tags"</li>
                          <li>Result: Front, Back, Tags (3 fields)</li>
                        </ul>
                      </li>
                      <li>
                        <strong>Create "Cloze with Tags" note type:</strong>
                        <ul className="ml-4 list-disc mt-1">
                          <li>Tools → Manage Note Types → Add</li>
                          <li>Choose "Cloze" → Name it "Cloze with Tags"</li>
                          <li>Click Fields → Add field "Tags"</li>
                          <li>Result: Text, Back Extra, Tags (3 fields)</li>
                        </ul>
                      </li>
                    </ol>
                  </div>

                  <div className="border-t-2 border-amber-200 pt-3">
                    <p className="font-bold mb-2">📥 IMPORT PROCESS (Separate for Basic and Cloze):</p>
                    <p className="mb-2 text-xs text-amber-800">
                      Files include native headers (<code>#separator:tab</code> & <code>#html:true</code>), so Anki automatically enables HTML formatting and sets Tab separation. Back fields are formatted with <code>&lt;div style="text-align: left;"&gt;</code> to prevent Anki from centering bullet points.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                      <div className="bg-blue-50/80 border border-blue-200 p-3 rounded">
                        <p className="font-semibold text-blue-900">For BASIC CARDS:</p>
                        <ol className="ml-4 list-decimal mt-1 space-y-1 text-xs text-blue-950">
                          <li>Click <strong>Copy Basic</strong> or <strong>Download Basic (.txt)</strong></li>
                          <li>In Anki: <strong>File → Import</strong></li>
                          <li>Select Note Type: <strong>"Basic with Tags"</strong></li>
                          <li>Select Deck: <strong>{deckName || 'Your Deck'}</strong></li>
                          <li>Map fields: <code>Field 1 → Front</code>, <code>Field 2 → Back</code>, <code>Field 3 → Tags</code></li>
                          <li>Click <strong>Import</strong></li>
                        </ol>
                      </div>

                      <div className="bg-purple-50/80 border border-purple-200 p-3 rounded">
                        <p className="font-semibold text-purple-900">For CLOZE CARDS:</p>
                        <ol className="ml-4 list-decimal mt-1 space-y-1 text-xs text-purple-950">
                          <li>Click <strong>Copy Cloze</strong> or <strong>Download Cloze (.txt)</strong></li>
                          <li>In Anki: <strong>File → Import</strong></li>
                          <li>Select Note Type: <strong>"Cloze with Tags"</strong></li>
                          <li>Select Deck: <strong>{deckName || 'Your Deck'}</strong></li>
                          <li>Map fields: <code>Field 1 → Text</code>, <code>Field 2 → Tags</code></li>
                          <li>Click <strong>Import</strong></li>
                        </ol>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
