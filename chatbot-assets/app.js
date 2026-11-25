'use strict';

const byId = id => document.getElementById(id);
const keywordSelect = byId('keyword');
const wordList = byId('keyword-words');
const ruleList = byId('rule-list');
const replyList = byId('reply-list');
const addWordRow = byId('add-word').closest('li');
const addRuleRow = byId('add-rule').closest('li');
const addReplyRow = byId('add-reply').closest('li');
const chatLog = byId('chat-log');
const input = byId('chat-input');
const defaultKeyword = 'COMPUTER';
const examples = [...document.querySelectorAll('[data-example]')];
const chatControls = [input, byId('send'), ...examples];
const explainedInput = byId('explained-input');
const explainedControls = [explainedInput, byId('run-message')];
const tabs = [...document.querySelectorAll('[role="tab"]')];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const chatEngine = window.ElizaHay.make({matchOriginalWords:true, randomReplies:true});
const session = {
  engine: window.ElizaHay.make({matchOriginalWords:true, randomReplies:true, orderKeywordsByPriority:true}),
  groupNames: new Set(),
  wordDefaults: new Map(),
  deletedGroups: new Map()
};
let boardSelection;
let replyEditor;
let pending = false;
let chatPending = false;
let animationTimer;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function readable(text) {
  return text.toLowerCase().replace(/\b(?:i|ai|gpt)\b/g, word => word.toUpperCase()).replace(/\bchatgpt\b/g, 'ChatGPT');
}

function keywordLabel(entry) {
  const word = readable(entry.keyword);
  return '[' + entry.precedence + '] ' + word[0].toUpperCase() + word.slice(1);
}

function sentence(text) {
  const line = readable(text).replace(/\s+/g, ' ').replace(/“\s+/g, '“').replace(/\s+([,.!?”])/g, '$1').trim()
    .replace(/(^|[.!?]\s+)[a-z]/g, word => word.toUpperCase());
  if (!line || /[.!?]$/.test(line)) return line;
  const question = /^(?:am|are|can|can't|could|do|don't|does|did|have|how|in what|is|isn't|of what|should|what|when|where|which|who|why|will|would|wouldn't|were)\b/i.test(line);
  return line + (question ? '?' : '.');
}

function slotTag(name) {
  return '[' + (name.length === 1 ? name.toUpperCase() : name) + ']';
}

function formatTemplate(tokens, parts, names, terms) {
  const formatted = sentence(tokens.map(token => /^\d+$/.test(token)
    ? (parts ? parts[Number(token) - 1] || '' : names.has(token) ? slotTag(names.get(token)) : terms[Number(token) - 1] || '')
    : token).join(' '));
  return parts ? formatted : formatted.replace(/\[([^\[\]]+)\]/g, (_, name) => slotTag(name.toLowerCase()));
}

function replySlots(rule) {
  return [...new Set(rule.reassembly.flatMap(option => option.split(' ').filter(token => /^\d+$/.test(token))))]
    .sort((a, b) => Number(a) - Number(b));
}

function captureNames(rule) {
  const terms = ruleTerms(rule);
  const explicitSlots = Object.keys(rule.slotLabels || {});
  const positions = [...new Set([...replySlots(rule), ...explicitSlots])]
    .filter(slot => explicitSlots.includes(slot) || /^[\d(]/.test(terms[Number(slot) - 1] || ''))
    .sort((a, b) => Number(a) - Number(b));
  const names = new Map();
  const reservedNames = new Set(positions.map(slot => rule.slotLabels?.[slot]).filter(name => /^slot [1-9]\d*$/.test(name)));
  let next = 1;
  for (const slot of positions) {
    const preferred = rule.slotLabels?.[slot];
    if (reservedNames.has(preferred)) {
      names.set(slot, preferred);
    } else {
      while (reservedNames.has('slot ' + next)) next++;
      names.set(slot, 'slot ' + next++);
    }
  }
  return names;
}

function ruleGroup(keyword) {
  let entry = session.keywords.get(keyword);
  const seen = new Set();
  while (entry && !entry.transforms.length && entry.link && !seen.has(entry.keyword)) {
    seen.add(entry.keyword);
    entry = session.keywords.get(entry.link);
  }
  return entry;
}

function ruleTerms(rule) {
  return rule.decomposition.slice(1, -1).match(/\([^()]*\)|[^\s()]+/g) || [];
}

function conditionWords(term) {
  if (term.startsWith('(*')) return term.slice(2, -1).trim().split(/\s+/);
  if (!term.startsWith('(/')) return [];
  const tags = term.slice(2, -1).trim().split(/\s+/);
  return [...session.keywords.values()]
    .filter(entry => tags.some(tag => entry.tags.includes(tag)))
    .map(entry => entry.keyword);
}

function conditionText(term) {
  const words = conditionWords(term);
  const separator = words.length > 3 ? ' / ' : '/';
  return words.length ? readable(words.join(separator)) : readable(term.replace(/^\((.*)\)$/, '$1'));
}

function patternParts(rule) {
  const names = captureNames(rule);
  return ruleTerms(rule).map((term, index) => {
    const slot = names.get(String(index + 1));
    const condition = conditionText(term);
    if (slot) return slotTag(slot).slice(0, -1) + (term === '0' ? '' : ': ' + condition) + ']';
    if (term === '0') return '*';
    return term.startsWith('(') ? '[' + condition + ']' : condition;
  });
}

function termMeaning(term) {
  const words = conditionWords(term).map(readable);
  if (words.length > 1) return 'one of ' + new Intl.ListFormat('en', {type:'disjunction'}).format(words);
  if (words.length === 1) return 'the word “' + words[0] + '”';
  if (/^[1-9]\d*$/.test(term)) return term + (term === '1' ? ' word' : ' words');
  return 'the word “' + conditionText(term) + '”';
}

function showCaptureGuide(rule) {
  const guide = byId('capture-guide');
  guide.replaceChildren();
  if (!rule) return;
  const names = captureNames(rule);
  const terms = ruleTerms(rule);
  if (names.size < 2 && ![...names.keys()].some(slot => terms[Number(slot) - 1] !== '0')) return;

  names.forEach((name, slot) => {
    const index = Number(slot) - 1;
    const term = terms[index];
    if (!term) return;
    let meaning = term === '0' ? 'Any words matched by this part' : termMeaning(term);
    if (term === '(/FAMILY)') meaning = 'The family word from your message';
    if (term === '0' && index > 0 && terms[index - 1] !== '0') {
      const previousSlot = names.get(String(index));
      meaning = 'Words after ' + (previousSlot ? slotTag(previousSlot) : termMeaning(terms[index - 1]));
    }
    const row = element('div');
    row.append(element('dt', slotTag(name), 'pattern-capture'), ' ',
      element('dd', meaning[0].toUpperCase() + meaning.slice(1)));
    guide.append(row);
  });
}

function wordsForGroup(keyword) {
  const words = [...session.keywords.values()].filter(entry => entry.enabled &&
    ((session.groupNames.has(entry.keyword) && entry.keyword === keyword) ||
      (entry.link && ruleGroup(entry.keyword)?.keyword === keyword)));
  return words.map(entry => entry.keyword).sort((a, b) => a.localeCompare(b, 'en'));
}

function browsingOptions(rule, visited = new Set()) {
  visited.add(rule);
  if (rule.reassembly.length === 1 && rule.reassembly[0] === 'NEWKEY') {
    const fallback = browsingOptions(session.keywords.get('NONE').transforms[0], visited);
    return {...fallback, triesNextKeyword:true};
  }
  const replies = [];
  const destinations = [];
  const names = captureNames(rule);
  const terms = ruleTerms(rule);
  let linkedGroup;
  rule.reassembly.forEach(option => {
    if (option === 'NEWKEY') destinations.push('Tries another keyword.');
    else if (option.startsWith('=') || option.startsWith('(')) {
      const destination = /=\s*([A-Z'-]+)/.exec(option)?.[1];
      if (!destination) return;
      const target = session.deletedGroups.has(destination) ? null : ruleGroup(destination);
      const targetRule = target?.transforms[0];
      if (rule.reassembly.length === 1 && target?.transforms.length === 1 &&
          targetRule.decomposition === '(0)' && !visited.has(targetRule)) {
        const linked = browsingOptions(targetRule, visited);
        if (linked.replies.length && !linked.triesNextKeyword) {
          replies.push(...linked.replies);
          linkedGroup = linked.linkedGroup || target.keyword;
          return;
        }
      }
      destinations.push(session.deletedGroups.has(destination) ? 'The ' + destination + ' rule group was deleted.'
        : 'Continues in the ' + destination + ' rule group.');
    } else replies.push(formatTemplate(option.split(' '), null, names, terms));
  });
  return {replies, destinations, linkedGroup};
}

function selectionFor(turn, reply) {
  const matchingKeywords = [...new Map(turn.keystack.map(entry => [entry.word, entry])).values()];
  const match = turn.steps.findLast(event => event.kind === 'decompose');
  const build = turn.steps.findLast(event => event.kind === 'reassemble');
  if (!match || !build) {
    const saved = turn.steps.some(event => event.kind === 'memory-recall');
    return {keyword:'', ruleIndex:null, usedReply:0, matchingKeywords, replies:[reply], kind:saved ? 'saved' : 'general'};
  }

  const fallback = turn.steps.some(event => event.kind === 'none');
  const group = session.keywords.get(fallback ? 'NONE' : match.keyword);
  const passedKeyword = turn.steps.findLast(event => event.kind === 'newkey')?.from;
  const inputKeyword = fallback ? null : build.inputKeyword;
  const ruleIndex = build.ruleIndex;
  const usedReply = build.selectedReply - 1;
  const rule = group.transforms[ruleIndex];
  const names = captureNames(rule);
  const replies = build.replyOptions.map(option => formatTemplate(option, null, names, ruleTerms(rule)));
  const captures = [...names].map(([slot, name]) => [name, build.components[Number(slot) - 1] || '']);
  return {keyword:group.keyword, group, inputKeyword, passedKeyword, words:wordsForGroup(group.keyword), ruleIndex, captures,
    usedReply, matchingKeywords, replies, kind:fallback ? 'general' : 'rule'};
}

function showInList(list, row) {
  if (row.offsetTop < list.scrollTop || row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = row.offsetTop - 3;
  }
}

function deleteButton(label, remove) {
  const button = element('button', '−', 'delete-row');
  button.type = 'button';
  button.setAttribute('aria-label', 'Delete ' + label);
  button.addEventListener('click', () => { if (!pending) remove(); });
  return button;
}

function editableField(value, label, statusId, save, className = '', singleLine = false) {
  const field = element(singleLine ? 'input' : 'textarea', undefined, 'row-field ' + className);
  field.value = value;
  field.autocomplete = 'off';
  field.spellcheck = false;
  if (!singleLine) field.rows = 1;
  field.setAttribute('aria-label', label);
  field.setAttribute('aria-describedby', 'save-hint ' + statusId);
  field.addEventListener('input', () => {
    if (field.getAttribute('aria-invalid') === 'true') {
      field.removeAttribute('aria-invalid');
      editorStatus('', false, statusId);
    }
  });
  field.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    if (pending || field.value.trim() === value) return;
    const error = save(field.value);
    if (error) {
      field.setAttribute('aria-invalid', 'true');
      editorStatus(error, true, statusId);
    }
  });
  return field;
}

function wordRow(keyword, words, index) {
  const word = words[index];
  const row = element('li', undefined, 'editor-row word-row');
  const field = editableField(word ? readable(word) : '', word ? 'Word ' + (index + 1) : 'New word',
    'words-status', value => {
      const next = normalize(value);
      if (!wordSyntax.test(next)) return 'Enter one word in each box. Use + to enter another.';
      if (!validGroupWords([next], keyword)) return 'Enter a word that is available for this group.';
      if (words.includes(next) && word !== next) return 'This word is already in the group.';
      const updated = words.slice();
      updated[index] = next;
      updateWords(updated);
    }, '', true);
  if (!word) field.placeholder = 'New word';
  row.append(field, deleteButton(word ? readable(word) : 'new word', () => {
    if (word) updateWords(words.filter((_, i) => i !== index));
    else row.remove();
  }));
  return row;
}

function renderBoard(selection, animate = false, focusRule = false) {
  window.clearTimeout(animationTimer);
  boardSelection = selection;
  closeEditors();
  keywordSelect.querySelector('[data-deleted]')?.remove();
  if (session.deletedGroups.has(selection.keyword)) {
    const previous = element('option', selection.keyword + ' (deleted)');
    previous.value = selection.keyword;
    previous.disabled = true;
    previous.dataset.deleted = '';
    keywordSelect.append(previous);
  }
  keywordSelect.value = selection.keyword;
  const group = selection.group || ruleGroup(selection.keyword);
  const editingCurrent = !selection.group || selection.group === ruleGroup(selection.keyword);
  const general = selection.keyword === 'NONE' || selection.kind === 'general';
  const canEditGroup = editingCurrent && !!group && !general && !session.deletedGroups.has(selection.keyword);
  byId('delete-group').disabled = !canEditGroup;
  const keywordPriority = byId('keyword-priority');
  byId('keyword-priority-control').hidden = !canEditGroup;
  keywordPriority.value = group?.precedence ?? '';
  keywordPriority.removeAttribute('aria-invalid');
  const note = byId('group-note');
  const words = selection.words || wordsForGroup(selection.keyword);
  const sharedGroup = selection.inputKeyword && selection.inputKeyword !== selection.keyword &&
    ruleGroup(selection.inputKeyword)?.keyword !== selection.keyword
    ? readable(selection.inputKeyword) + ' leads to the ' + selection.keyword + ' rule group.' : '';
  const passed = selection.passedKeyword
    ? readable(selection.passedKeyword) + ' passed to the next keyword in the message.' : '';
  note.textContent = [sharedGroup, passed].filter(Boolean).join(' ');
  const matches = byId('keyword-match');
  matches.replaceChildren();
  matches.hidden = !selection.matchingKeywords;
  if (selection.matchingKeywords?.length) {
    matches.append('Matched keywords ', ...selection.matchingKeywords.map(({word, rank}) => {
      const chosen = selection.inputKeyword === word;
      const label = '[' + rank + '] ' + readable(word) + (chosen ? ' · used' : '');
      const badge = element('span', label, chosen ? 'keyword-chip keyword-chosen' : 'keyword-chip');
      if (chosen) badge.title = 'Keyword used for this reply';
      return badge;
    }));
  } else if (!matches.hidden) {
    matches.textContent = 'No keywords found.';
  }
  byId('group-members').hidden = !group || general;
  [addWordRow, addRuleRow, byId('restore-words'), byId('restore-rules')].forEach(control => {
    control.hidden = !canEditGroup;
  });
  wordList.replaceChildren(...words.map((word, index) => canEditGroup
    ? wordRow(selection.keyword, words, index) : element('li', readable(word))), addWordRow);
  ruleList.replaceChildren();
  replyList.replaceChildren();
  let selectedRule;

  if (general || selection.kind === 'saved') {
    selectedRule = element('li', general ? 'No matching keyword rule' : 'Reply saved from an earlier turn', 'route-result');
    ruleList.append(selectedRule);
  } else if (group) {
    group.transforms.forEach((rule, index) => {
      const row = element('li', undefined, 'editor-row rule-row');
      const label = 'Rule ' + (index + 1);
      const button = element('button', undefined, 'rule-button');
      const arrow = element('span', '→', 'rule-arrow');
      arrow.setAttribute('aria-hidden', 'true');
      button.append(label, arrow);
      button.type = 'button';
      button.addEventListener('click', () => {
        renderBoard({keyword:selection.keyword, group:selection.group, ruleIndex:index}, false, true);
      });
      const selected = index === selection.ruleIndex;
      button.setAttribute('aria-pressed', String(selected));
      if (selected) {
        row.classList.add('rule-selected');
        selectedRule = row;
      }
      const value = patternParts(rule).join(' ');
      row.append(button);
      if (canEditGroup) {
        const field = editableField(value, 'Pattern for ' + label, 'editor-status',
          text => savePattern(group.keyword, rule, index, text), 'pattern-input');
        row.append(field, deleteButton(label, () => {
          session.engine.deleteRule(group.keyword, index);
          const current = selection.ruleIndex;
          refreshBoard(selection.keyword, current === null ? null :
            Math.min(current - (index < current ? 1 : 0), group.transforms.length - 2));
        }));
      } else {
        row.append(element('code', value, 'readonly-template'));
      }
      ruleList.append(row);
    });
  }

  ruleList.append(addRuleRow);

  const captures = byId('captured-content');
  captures.replaceChildren();
  captures.hidden = !selection.captures?.length;
  if (!captures.hidden) {
    captures.append(element('strong', 'Matched words: '));
    selection.captures.forEach(([name, words], index) => {
      if (index) captures.append(' · ');
      captures.append(element('code', slotTag(name), 'pattern-capture'), ' = ', words ? readable(words) : '(empty)');
    });
  }

  const rule = group?.transforms[selection.ruleIndex];
  byId('rule-order-control').hidden = !canEditGroup || !rule || group.transforms.length < 2;
  byId('move-rule-up').disabled = !rule || selection.ruleIndex === 0;
  byId('move-rule-down').disabled = !rule || selection.ruleIndex === group.transforms.length - 1;
  showCaptureGuide(general ? null : rule);
  const {replies, destinations, linkedGroup, triesNextKeyword} = selection.replies
    ? {replies:selection.replies, destinations:[]}
    : rule ? browsingOptions(rule) : {replies:[], destinations:[]};
  const replyGroup = linkedGroup ? ruleGroup(linkedGroup) : group;
  const replyRule = linkedGroup ? 0 : selection.ruleIndex;
  const ownedRule = replyGroup?.transforms[replyRule];
  replyEditor = editingCurrent && ownedRule && !session.deletedGroups.has(selection.keyword) &&
    !triesNextKeyword && (!destinations.length || replies.length)
    ? {keyword:replyGroup.keyword, rule:ownedRule, index:replyRule} : null;
  addReplyRow.hidden = !replyEditor;
  byId('restore-replies').hidden = !replyEditor;
  const slots = byId('reply-slots');
  slots.replaceChildren();
  if (replyEditor) {
    const names = [...captureNames(replyEditor.rule).values()];
    if (names.length) slots.append('Optional slots ', ...names.map(name => element('code', slotTag(name), 'pattern-capture')));
  }
  const context = byId('reply-context');
  if (general) context.textContent = replies.length + (replies.length === 1 ? ' general reply' : ' general replies');
  else if (selection.kind === 'saved') context.textContent = 'Saved reply';
  else if (triesNextKeyword) context.textContent = 'Tries the next keyword in the same message. If no other rule matches, it uses a general reply.';
  else if (linkedGroup) context.textContent = replies.length + (replies.length === 1 ? ' reply' : ' replies') + ' from the ' + linkedGroup + ' rule group.';
  else if (rule) context.textContent = replies.length + (replies.length === 1 ? ' reply' : ' replies') + ' for Rule ' + (selection.ruleIndex + 1);
  else if (group && !group.transforms.length) context.textContent = 'Add a rule to see its replies.';
  else context.textContent = 'Choose a rule to see its replies.';
  if (!replies.length && destinations.length) context.textContent = destinations.join(' ');

  replies.forEach((reply, index) => replyList.append(replyRow(replyEditor, reply, index)));
  replyList.append(addReplyRow);
  replyList.scrollTop = 0;

  if (selectedRule) {
    showInList(ruleList, selectedRule);
    if (focusRule) selectedRule.querySelector('button')?.focus({preventScroll:true});
  }
  if (selection.usedReply === undefined) return;
  if (selectedRule) {
    selectedRule.classList.add('rule-used');
    if (selection.kind === 'rule') selectedRule.append(element('span', 'Matched', 'rule-match-label'));
    if (animate) selectedRule.classList.add('glow');
  }
  const used = selection.usedReply < replies.length && replyList.children[selection.usedReply];
  if (!used) return;
  const highlight = () => {
    used.classList.add('reply-used');
    if (animate) used.classList.add('glow');
    used.setAttribute('aria-current', 'true');
    used.append(element('span', 'Used', 'used-label'));
    showInList(replyList, used);
  };
  if (animate && !reducedMotion.matches) animationTimer = window.setTimeout(highlight, 320);
  else highlight();
}

async function sendChat(text) {
  const message = text.trim();
  if (!message || chatPending) return;
  chatPending = true;
  const status = byId('chat-status');
  status.textContent = '';
  chatControls.forEach(control => { control.disabled = true; });
  byId('clear-chat').disabled = true;
  try {
    const turn = await chatEngine.trace(message);
    const article = element('article', undefined, 'turn');
    article.append(element('p', turn.input, 'message user'), element('p', sentence(turn.output), 'message eliza'));
    chatLog.append(article);
    chatLog.scrollTop = chatLog.scrollHeight;
    input.value = '';
  } catch (error) {
    console.error(error);
    status.textContent = 'The message could not be processed. Please try it again.';
  } finally {
    chatPending = false;
    chatControls.forEach(control => { control.disabled = false; });
    byId('clear-chat').disabled = !chatLog.childElementCount;
    if (!byId('chat-panel').hidden) input.focus({preventScroll:true});
  }
}

async function runExplained() {
  const message = explainedInput.value.trim();
  if (!message || pending) return;
  pending = true;
  const status = byId('explained-status');
  const output = byId('explained-output');
  status.textContent = '';
  explainedControls.forEach(control => { control.disabled = true; });
  try {
    session.engine.clearConversation();
    const turn = await session.engine.trace(message);
    const reply = sentence(turn.output);
    renderBoard(selectionFor(turn, reply), true);
    output.textContent = reply;
  } catch (error) {
    console.error(error);
    status.textContent = 'The message could not be processed. Please try it again.';
  } finally {
    pending = false;
    explainedControls.forEach(control => { control.disabled = false; });
    if (!byId('explained-panel').hidden) explainedInput.focus({preventScroll:true});
  }
}

const editors = [
  {button:byId('new-group'), form:byId('new-group-form'), field:byId('new-group-name')},
  {button:byId('add-rule'), form:byId('add-rule-form'), field:byId('add-rule-pattern')},
  {button:byId('add-reply'), form:byId('add-reply-form'), field:byId('add-reply-text')}
];
const wordSyntax = /^[A-Z][A-Z0-9]*(?:['-][A-Z0-9]+)*$/;
const reserved = new Set(['BUT', 'NONE', 'MEMORY', 'NEWKEY']);
const normalize = text => text.trim().toUpperCase().replaceAll('’', "'");

function loadGroups() {
  const dictionary = session.engine.dictionary().filter(entry => !entry.isMemory);
  session.keywords = new Map(dictionary.map(entry => [entry.keyword, entry]));
  if (!session.groupNames.size) {
    dictionary.filter(entry => entry.keyword !== 'NONE' && entry.transforms.length)
      .forEach(entry => session.groupNames.add(entry.keyword));
  }
  renderGroupOptions();
}

function renderGroupOptions() {
  const groups = [...session.groupNames].filter(keyword => !session.deletedGroups.has(keyword))
    .map(keyword => session.keywords.get(keyword))
    .sort((a, b) => b.precedence - a.precedence || a.keyword.localeCompare(b.keyword, 'en'));
  const placeholder = element('option', 'Choose a keyword group');
  placeholder.value = '';
  placeholder.disabled = true;
  const general = element('option', 'General replies');
  general.value = 'NONE';
  const options = groups.map(entry => {
    const option = element('option', keywordLabel(entry));
    option.value = entry.keyword;
    return option;
  });
  keywordSelect.replaceChildren(placeholder, ...options, general);
}

function editorStatus(text = '', error = false, statusId = 'editor-status') {
  const status = byId(statusId);
  status.textContent = text;
  status.classList.toggle('error', error);
}

function closeEditors() {
  editors.forEach(({button,form}) => {
    form.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  });
  ['group-status', 'words-status', 'editor-status', 'replies-status'].forEach(id => editorStatus('', false, id));
}

function groupWordsInput(text) {
  return [...new Set(normalize(text).split(/[,/]/).map(word => word.trim()).filter(Boolean))];
}

function validGroupWords(words, keyword) {
  return words.length > 0 && words.every(word => wordSyntax.test(word) && !reserved.has(word) &&
    (!session.keywords.has(word) || ruleGroup(word)?.keyword === keyword));
}

function parseCondition(text) {
  if (/^(?:\/[A-Z]+|[1-9]\d*)$/.test(text)) {
    return [text.startsWith('/') ? '(' + text + ')' : text];
  }
  if (text.includes('|') || text.includes('/')) {
    const choices = text.split(/[|/]/).map(word => word.trim());
    return choices.every(word => wordSyntax.test(word)) ? ['(* ' + choices.join(' ') + ')'] : null;
  }
  const phrase = text.split(/\s+/);
  return phrase.every(word => wordSyntax.test(word)) ? phrase : null;
}

const slotName = text => text.trim().toLowerCase().replace(/\s+/g, ' ');

function parsePattern(text) {
  const pattern = normalize(text).replace(/[“”]/g, '"');
  const cells = pattern.match(/\*|"[^"]+"|\[[^\[\]]+\]|[A-Z][A-Z0-9]*(?:['-][A-Z0-9]+)*|[1-9]\d*/g);
  if (!cells || cells.join('').replace(/\s+/g, '') !== pattern.replace(/\s+/g, '')) return null;
  const tokens = [];
  const captures = new Map();
  for (const cell of cells) {
    if (cell === '*') tokens.push('0');
    else if (cell.startsWith('"')) {
      const condition = parseCondition(cell.slice(1, -1).trim());
      if (!condition) return null;
      tokens.push(...condition);
    } else if (cell.startsWith('[')) {
      const inside = cell.slice(1, -1).trim();
      if (inside.includes('/') && !inside.includes(':')) {
        const choices = parseCondition(inside);
        if (!choices) return null;
        tokens.push(...choices);
        continue;
      }
      const capture = /^([A-Z0-9][A-Z0-9 _'-]*?)(?:\s*:\s*(.+))?$/.exec(inside);
      if (!capture) return null;
      const name = slotName(capture[1]);
      const condition = capture[2] ? parseCondition(capture[2]) : ['0'];
      if (!condition || condition.length !== 1 || captures.has(name)) return null;
      captures.set(name, String(tokens.length + 1));
      tokens.push(condition[0]);
    } else {
      tokens.push(cell);
    }
  }
  return {tokens, captures};
}

function parseReply(text, captures = new Map()) {
  const normalized = normalize(text);
  const words = normalized.match(/\[[^\[\]]+\]|[A-Z0-9'-]+|[.,!?“”]/g);
  if (!words || words.join('').replace(/\s+/g, '') !== normalized.replace(/\s+/g, '') ||
      !words.some(word => /[A-Z]/.test(word) || word.startsWith('['))) return null;
  const slots = new Set(words.filter(word => word.startsWith('[')).map(word => slotName(word.slice(1, -1))));
  if (normalized === 'NEWKEY' || words.some(word => /^\d+$/.test(word)) ||
      [...slots].some(slot => !captures.has(slot))) return null;
  return words.map(word => word.startsWith('[') ? captures.get(slotName(word.slice(1, -1))) : word);
}

function labelsFor(pattern) {
  return Object.fromEntries([...pattern.captures].map(([name, position]) => [position, name]));
}

function showAvailableSlots(target, names, replyInput) {
  target.replaceChildren();
  if (!names.length) {
    target.textContent = 'Add [slot 1] to the pattern to reuse words in the reply.';
    return;
  }
  target.append('Optional slots ');
  names.forEach(name => {
    const tag = slotTag(name);
    const button = element('button', tag, 'pattern-capture');
    button.type = 'button';
    button.setAttribute('aria-label', 'Insert ' + tag);
    button.addEventListener('click', () => {
      replyInput.setRangeText(tag, replyInput.selectionStart, replyInput.selectionEnd, 'end');
      replyInput.focus();
    });
    target.append(button);
  });
}

function remapReplySlots(rule, pattern) {
  const names = captureNames(rule);
  const terms = ruleTerms(rule);
  const remapped = new Map();
  const unmatched = [];
  const newNames = new Map(pattern.captures);
  for (const slot of new Set([...replySlots(rule), ...names.keys()])) {
    const name = names.get(slot);
    if (!name) remapped.set(slot, terms[Number(slot) - 1]);
    else if (newNames.has(name)) {
      remapped.set(slot, newNames.get(name));
      newNames.delete(name);
    } else unmatched.push(slot);
  }
  unmatched.forEach((slot, index) => {
    const position = [...newNames.values()][index];
    if (position) remapped.set(slot, position);
  });
  return remapped;
}

function refreshBoard(keyword = boardSelection.keyword, ruleIndex = boardSelection.ruleIndex) {
  const ruleScroll = ruleList.scrollTop;
  const replyScroll = replyList.scrollTop;
  loadGroups();
  renderBoard({keyword, ruleIndex});
  ruleList.scrollTop = ruleScroll;
  replyList.scrollTop = replyScroll;
}

function updateWords(words) {
  const {keyword} = boardSelection;
  session.engine.setGroupWords(keyword, wordsForGroup(keyword), words);
  refreshBoard();
}

function savePattern(keyword, rule, index, text) {
  const pattern = parsePattern(text);
  if (!pattern) return 'Use *, exact words, [a/b] choices, or slots such as [slot 1].';
  const slots = remapReplySlots(rule, pattern);
  if (replySlots(rule).some(slot => !slots.has(slot))) {
    return 'A reply still uses a removed slot. Change that reply first.';
  }
  // Preserve exact DOCTOR tag matching when the displayed choices were left as they were.
  const displayedTags = new Map(ruleTerms(rule).filter(term => term.startsWith('(/'))
    .map(term => [parseCondition(normalize(conditionText(term)))?.[0], term]));
  const tokens = pattern.tokens.map(token => displayedTags.get(token) || token);
  session.engine.setRulePattern(keyword, index, tokens, null, slots, labelsFor(pattern));
  refreshBoard(keyword, index);
  ruleList.children[index]?.querySelector('.row-field')?.focus({preventScroll:true});
}

function parseRuleReply(text, rule) {
  const names = new Map([...captureNames(rule)].map(([position, name]) => [name, position]));
  return parseReply(text, names);
}

function replyRow(editor, value, index) {
  const row = element('li', undefined, 'editor-row reply-row');
  const label = 'Reply ' + (index + 1);
  row.append(element('span', label, 'reply-number'));
  if (!editor) {
    const template = element('p', undefined, 'readonly-template');
    value.split(/(\[slot [1-9]\d*\])/g).forEach(part => {
      template.append(part.startsWith('[slot ') ? element('code', part, 'pattern-capture') : part);
    });
    row.append(template);
    return row;
  }
  const {keyword, rule, index:ruleIndex} = editor;
  const field = editableField(value, label + ' template', 'replies-status', text => {
    const reply = parseRuleReply(text, rule);
    if (!reply) return 'Enter a reply. Only use slots shown above.';
    session.engine.editReply(keyword, ruleIndex, index, reply);
    refreshBoard();
    replyList.children[index]?.querySelector('.row-field')?.focus({preventScroll:true});
  });
  row.append(field, deleteButton(label, () => {
    if (session.engine.deleteReply(keyword, ruleIndex, index)) refreshBoard();
    else editorStatus('Keep at least one general reply.', true, 'replies-status');
  }));
  return row;
}

editors.forEach(({button,form,field}) => {
  button.addEventListener('click', () => {
    if (pending || (button.id === 'add-reply' && !replyEditor)) return;
    if (button.id === 'add-reply' && !form.hidden) {
      field.focus();
      return;
    }
    const open = form.hidden;
    closeEditors();
    if (!open) return;
    form.hidden = false;
    if (button.id === 'add-rule') {
      const word = wordsForGroup(boardSelection.keyword)[0] || boardSelection.keyword;
      field.placeholder = '* ' + readable(word) + ' *';
    }
    if (button.id === 'add-reply') {
      form.reset();
      field.removeAttribute('aria-invalid');
      const slots = byId('add-reply-slots');
      const names = [...captureNames(replyEditor.rule).values()];
      if (names.length) showAvailableSlots(slots, names, field);
      else slots.replaceChildren();
    }
    button.setAttribute('aria-expanded', 'true');
    field.focus();
  });
});

byId('add-word').addEventListener('click', () => {
  const {keyword} = boardSelection;
  const words = wordsForGroup(keyword);
  const draft = wordList.querySelector('[aria-label="New word"]');
  if (draft) {
    draft.focus();
    return;
  }
  const row = wordRow(keyword, words, words.length);
  addWordRow.before(row);
  row.querySelector('.row-field').focus();
});
byId('restore-words').addEventListener('click', () => {
  if (!pending) updateWords(session.wordDefaults.get(boardSelection.keyword));
});
byId('restore-rules').addEventListener('click', () => {
  if (pending) return;
  session.engine.restoreRules(boardSelection.keyword);
  refreshBoard(boardSelection.keyword, 0);
});
byId('add-reply-form').addEventListener('submit', event => {
  event.preventDefault();
  if (pending || !replyEditor) return;
  const {keyword, rule, index} = replyEditor;
  const input = byId('add-reply-text');
  const reply = parseRuleReply(input.value, rule);
  if (!reply) {
    input.setAttribute('aria-invalid', 'true');
    editorStatus('Check the reply text and use only the available slots.', true, 'replies-status');
    input.focus();
    return;
  }
  const replyIndex = replyList.children.length - 1;
  session.engine.addReply(keyword, index, reply);
  refreshBoard();
  const row = replyList.children[replyIndex];
  showInList(replyList, row);
  row.querySelector('.row-field')?.focus({preventScroll:true});
});
byId('cancel-reply').addEventListener('click', () => {
  closeEditors();
  byId('add-reply').focus();
});
byId('restore-replies').addEventListener('click', () => {
  if (pending || !replyEditor) return;
  if (session.engine.restoreReplies(replyEditor.keyword, replyEditor.index)) refreshBoard();
  else editorStatus('The original replies need a slot that was removed. Restore the original rule to recover it.', true, 'replies-status');
});

function showGroupUndo() {
  const lastDeleted = [...session.deletedGroups.keys()].at(-1);
  byId('group-deleted-message').textContent = lastDeleted ? lastDeleted + ' deleted.' : '';
  byId('group-undo').hidden = !lastDeleted;
}

function availableDefaultGroup() {
  return session.deletedGroups.has(defaultKeyword) ? keywordSelect.options[1].value : defaultKeyword;
}

byId('delete-group').addEventListener('click', () => {
  if (pending) return;
  const {keyword} = boardSelection;
  const words = wordsForGroup(keyword);
  session.engine.setGroupWords(keyword, words, []);
  session.engine.setGroupActive(keyword, false);
  session.deletedGroups.set(keyword, words);
  loadGroups();
  renderBoard({keyword:availableDefaultGroup(), ruleIndex:0});
  showGroupUndo();
  byId('undo-delete-group').focus();
});

byId('undo-delete-group').addEventListener('click', () => {
  if (pending) return;
  const keyword = [...session.deletedGroups.keys()].at(-1);
  if (!keyword) return;
  session.engine.setGroupWords(keyword, [], session.deletedGroups.get(keyword));
  session.engine.setGroupActive(keyword, true);
  session.deletedGroups.delete(keyword);
  loadGroups();
  renderBoard({keyword, ruleIndex:0});
  showGroupUndo();
  keywordSelect.focus();
});

document.querySelectorAll('.rule-example').forEach(node => {
  node.append(byId('pattern-reply-example').content.cloneNode(true));
});
for (const prefix of ['new-group', 'add-rule']) {
  const pattern = byId(prefix + '-pattern');
  const update = () => showAvailableSlots(byId(prefix + '-slots'),
    [...(parsePattern(pattern.value)?.captures.keys() || [])], byId(prefix + '-reply'));
  pattern.addEventListener('input', update);
  pattern.form.addEventListener('reset', () => queueMicrotask(update));
  update();
}

byId('new-group-form').addEventListener('submit', event => {
  event.preventDefault();
  if (pending) return;
  const keyword = normalize(byId('new-group-name').value);
  const words = groupWordsInput(byId('new-group-words').value);
  const pattern = parsePattern(byId('new-group-pattern').value);
  const reply = pattern && parseReply(byId('new-group-reply').value, pattern.captures);
  if (!wordSyntax.test(keyword) || reserved.has(keyword) || session.keywords.has(keyword) ||
      !validGroupWords(words, keyword) || !reply) {
    editorStatus('Enter an unused group name and trigger words, a valid pattern, and a reply.', true, 'group-status');
    return;
  }
  session.engine.addRule(keyword, pattern.tokens, reply, labelsFor(pattern));
  session.engine.setGroupWords(keyword, [keyword], words);
  session.groupNames.add(keyword);
  session.wordDefaults.set(keyword, words);
  event.target.reset();
  loadGroups();
  renderBoard({keyword, ruleIndex:0});
  editorStatus('Group added.', false, 'group-status');
  keywordSelect.focus();
});

byId('add-rule-form').addEventListener('submit', event => {
  event.preventDefault();
  if (pending) return;
  const pattern = parsePattern(byId('add-rule-pattern').value);
  const reply = pattern && parseReply(byId('add-rule-reply').value, pattern.captures);
  if (!pattern || !reply) {
    editorStatus('Enter a valid pattern and a reply. Any slots in the reply must appear in the pattern.', true);
    return;
  }
  const {keyword} = boardSelection;
  session.engine.addRule(keyword, pattern.tokens, reply, labelsFor(pattern));
  event.target.reset();
  loadGroups();
  renderBoard({keyword, ruleIndex:0}, false, true);
  editorStatus('Rule 1 added.');
});

keywordSelect.addEventListener('change', () => renderBoard({
  keyword:keywordSelect.value,
  ruleIndex:0
}));
byId('chat-form').addEventListener('submit', event => {
  event.preventDefault();
  sendChat(input.value);
});
examples.forEach(button => button.addEventListener('click', () => sendChat(button.dataset.example)));
byId('clear-chat').addEventListener('click', () => {
  chatEngine.clearConversation();
  chatLog.replaceChildren();
  byId('chat-status').textContent = '';
  byId('clear-chat').disabled = true;
  input.value = '';
  input.focus({preventScroll:true});
});

byId('explained-form').addEventListener('submit', event => {
  event.preventDefault();
  runExplained();
});

const priorityControl = byId('keyword-priority');
function saveKeywordPriority() {
  if (pending) return;
  const {keyword, ruleIndex} = boardSelection;
  const priority = priorityControl.valueAsNumber;
  if (!Number.isSafeInteger(priority) || priority < 0) {
    priorityControl.setAttribute('aria-invalid', 'true');
    editorStatus('Enter a whole number of 0 or more.', true, 'group-status');
    return;
  }
  if (priorityControl.getAttribute('aria-invalid') === 'true') {
    priorityControl.removeAttribute('aria-invalid');
    editorStatus('', false, 'group-status');
  }
  if (priority === session.keywords.get(keyword)?.precedence) return;
  session.engine.setKeywordPriority(keyword, priority);
  refreshBoard(keyword, ruleIndex);
  byId('explained-output').textContent = 'Run again to test the new priority.';
}
priorityControl.addEventListener('change', saveKeywordPriority);
priorityControl.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  saveKeywordPriority();
});

for (const [id, offset] of [['move-rule-up', -1], ['move-rule-down', 1]]) {
  byId(id).addEventListener('click', () => {
    if (pending) return;
    const {keyword, ruleIndex} = boardSelection;
    if (!session.engine.moveRule(keyword, ruleIndex, offset)) return;
    loadGroups();
    renderBoard({keyword, ruleIndex:ruleIndex + offset});
    byId('explained-output').textContent = 'Run again to test the new rule order.';
  });
}

function showTab(selected) {
  tabs.forEach(tab => {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    byId(tab.getAttribute('aria-controls')).hidden = !active;
  });
  if (selected.id === 'explained-tab') {
    const chosenRule = ruleList.querySelector('.rule-selected');
    const chosenReply = replyList.querySelector('.reply-used');
    if (chosenRule) showInList(ruleList, chosenRule);
    if (chosenReply) showInList(replyList, chosenReply);
  }
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => showTab(tab));
  tab.addEventListener('keydown', event => {
    const direction = {ArrowLeft:-1, ArrowRight:1}[event.key];
    if (!direction && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1)
      : tabs[(index + direction + tabs.length) % tabs.length];
    showTab(next);
    next.focus();
  });
});

loadGroups();
for (const keyword of session.groupNames) session.wordDefaults.set(keyword, wordsForGroup(keyword));
renderBoard({keyword:defaultKeyword, ruleIndex:0});
