'use strict';

const STARTER = 'I feel happy.';
const WORKFLOW_SAMPLE = 'You surprised me.';
const makeEngine = window.ElizaHay.make;
const byId = id => document.getElementById(id);
const log = byId('chat-log');
const explanation = byId('reply-explanation');
const traceBody = byId('trace-body');
const message = byId('chat-input');
const examples = [...document.querySelectorAll('[data-example]')];
const tabs = [...document.querySelectorAll('[role="tab"]')];
const pendingControls = [byId('send'), byId('apply-template'), byId('restore-template'), byId('add-rule'), byId('try-workflow'), ...examples];
const perspectiveWords = new Set(['I', 'ME', 'MY', 'MYSELF', 'YOU', 'YOUR', 'YOURSELF', "I'M", "YOU'RE", 'AM']);

let engine = makeEngine();
const originalGroups = new Map(engine.dictionary().filter(entry => !entry.isMemory && entry.keyword !== 'NONE' && entry.transforms.length).map(entry => [entry.keyword, entry]));
const ruleEdits = new Map();
const userRules = new Map();
const keywordAliases = new Map();
let keywordEntries;
let keywordList;
let pending = false;
let activeExplanationButton = null;

function syncDictionary() {
  const entries = engine.dictionary().filter(entry => !entry.isMemory);
  keywordEntries = new Map(entries.map(entry => [entry.keyword, entry]));
  keywordList = entries.filter(entry => entry.keyword !== 'NONE' && (entry.transforms.length || entry.link))
    .sort((first, second) => second.precedence - first.precedence || first.keyword.localeCompare(second.keyword, 'en'));
  byId('keyword-count').textContent = String(keywordList.length);
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function inlineWords(text) {
  return text.toLowerCase().replace(/\b(?:i|ai|gpt)\b/g, word => word.toUpperCase()).replace(/\bchatgpt\b/g, 'ChatGPT');
}

function displayReply(text) {
  const line = inlineWords(text).replace(/\s+([,?.!])/g, '$1').replace(/(^|[.!?]\s+)[a-z]/g, word => word.toUpperCase());
  if (!line || /[.!?]$/.test(line)) return line;
  const question = /^(?:am|are|can|could|do|does|did|have|how|in what|is|should|what|when|where|which|who|why|will|would|were)\b/i.test(line);
  return line + (question ? '?' : '.');
}

function appendTokens(container, words, renderWord) {
  words.forEach((word, index) => {
    if (index > 0 && !/^[,.!?]$/.test(word)) container.append(' ');
    container.append(renderWord(word, index));
  });
}

function appendWordTiles(container, text, highlight) {
  let cursor = 0;
  for (const match of text.matchAll(/\[\d+\]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)) {
    const word = match[0];
    const tile = element('span', word, 'word-token');
    const slot = /^\[(\d+)\]$/.exec(word);
    if (slot) tile.dataset.matchPart = slot[1];
    else if (typeof highlight === 'number') tile.dataset.matchPart = String(highlight);
    else if (highlight) tile.classList.add(highlight);
    container.append(text.slice(cursor, match.index), tile);
    cursor = match.index + word.length;
  }
  container.append(text.slice(cursor));
}

function step(list, label) {
  const block = element('li', undefined, 'trace-step');
  const heading = element('h3', undefined, 'step-label');
  const number = element('span', String(list.children.length + 1), 'step-number');
  const body = element('div', undefined, 'step-body');
  heading.tabIndex = -1;
  number.setAttribute('aria-hidden', 'true');
  heading.append(number, ' ', label);
  block.append(heading, body);
  list.append(block);
  return body;
}

function showKeywords(list, turn) {
  const item = step(list, 'Find the keywords');
  const source = element('div', undefined, 'token-line word-check');
  const status = element('p', undefined, 'keyword-status');
  status.setAttribute('role', 'status');
  source.setAttribute('role', 'group');
  source.setAttribute('aria-label', 'Words in your message');
  const dictionary = element('details', undefined, 'keyword-dictionary');
  const summary = element('summary', 'View all ' + keywordList.length + ' keywords');
  const ranks = element('dl', undefined, 'keyword-ranks');
  const rankLists = new Map();
  const dictionaryEntries = new Map(keywordList.map(({keyword:word, precedence:rank}) => {
    if (!rankLists.has(rank)) {
      const group = element('div');
      const words = element('ul', undefined, 'keyword-list');
      words.setAttribute('role', 'list');
      const definition = element('dd');
      definition.append(words);
      group.append(element('dt', 'Rank ' + rank), definition);
      ranks.append(group);
      rankLists.set(rank, words);
    }
    const entry = element('li', word, word === 'COMPUTER' ? 'computer-keyword' : undefined);
    rankLists.get(rank).append(entry);
    return [word, entry];
  }));
  dictionary.append(summary, ranks);

  const matches = new Map(turn.keystack.map(candidate => [candidate.word, candidate.rank]));
  const chosen = turn.keystack[0];
  const start = turn.clauseStart;
  const end = start + turn.clauseWords.length;
  const matchedButtons = [];
  appendTokens(source, turn.sourceWords, (word, index) => {
    const normalized = inlineWords(word);
    const readable = index === 0 ? normalized[0].toUpperCase() + normalized.slice(1) : normalized;
    if (word === '.' || word === ',' || word === 'BUT') {
      const delimiter = element('span', readable, 'word-token boundary-token');
      delimiter.title = 'Clause boundary';
      return delimiter;
    }
    if (!/[A-Z0-9]/.test(word)) return readable;

    const inClause = index >= start && index < end;
    const button = element('button', readable, 'word-token');
    button.type = 'button';
    if (inClause && matches.has(word)) matchedButtons.push([button, word]);
    button.addEventListener('click', () => {
      const entry = dictionaryEntries.get(word);
      button.dataset.check = entry ? 'found' : 'missing';
      if (entry) entry.classList.add('keyword-found');
      status.textContent = word + (entry
        ? ' is on the keyword list.' + (inClause ? '' : ' ELIZA stopped before this word.')
        : ' is absent from the keyword list.');
    });
    return button;
  });

  const result = element('div', undefined, 'keyword-result');
  result.hidden = true;
  if (chosen) {
    const inOrder = [...new Set(matchedButtons.map(([, word]) => word))];
    const found = element('ul', undefined, 'keyword-matches');
    found.setAttribute('aria-label', 'Keywords found and their rule groups');
    inOrder.forEach(word => {
      const entry = keywordEntries.get(word);
      const count = entry.transforms.length;
      const group = count === 0 && entry.link
        ? 'uses the rules for ' + entry.link
        : count + (count === 1 ? ' rule' : ' rules');
      const row = element('li');
      row.append(element('strong', word), ' · rank ' + matches.get(word) + ' · ' + group);
      found.append(row);
    });
    const decision = element('p');
    decision.append('ELIZA starts with the rules for ', element('strong', chosen.word));
    if (matches.size > 1) {
      const tied = [...matches].some(([word, rank]) => word !== chosen.word && rank === chosen.rank);
      decision.append(tied ? ' because it appears earliest among the highest-ranked keywords' : ' because it has the highest rank');
    }
    decision.append('.');
    result.append(found, decision);
    if (start > 0 || end < turn.sourceWords.length - 1) {
      result.append(element('p', 'ELIZA uses the first clause that contains a keyword.'));
    }
  } else {
    result.append(element('p', 'ELIZA found no keywords in this message.'));
  }

  const reveal = element('button', "Show ELIZA’s matches", 'secondary trace-action');
  reveal.type = 'button';
  item.append(
    element('p', 'ELIZA scans your message from left to right. Each keyword it finds points to the group of rules it can try.'),
    source, status, dictionary,
    element('p', 'Higher rank means higher priority. Click a word in your message to check the list.', 'step-detail'),
    reveal, result
  );
  return {reveal, result, matchedButtons, dictionaryEntries};
}

function showRewrites(list, turn) {
  const rewrites = new Map();
  turn.clauseWords.forEach((word, index) => {
    const before = turn.sourceWords[turn.clauseStart + index];
    if (word !== before) rewrites.set(before, word);
  });
  const swap = [...rewrites.keys()].some(word => perspectiveWords.has(word));
  const item = step(list, swap || !rewrites.size ? 'Switch perspective' : 'Apply substitutions');
  const purpose = swap || !rewrites.size
    ? 'During the same scan, the script switches words like “I” and “you” so phrases from your message fit naturally into a reply.'
    : 'During the same scan, ELIZA can replace a word with another form the rules can recognize.';
  item.append(element('p', purpose + ' The original words still determine which rule groups are used.'));
  const changes = element('p', undefined, 'step-detail');
  if (!rewrites.size) {
    changes.append(turn.clauseWords.length ? 'The words in this part of the message stay the same.' : 'No part of this message was passed to a keyword rule.');
  } else {
    [...rewrites.entries()].forEach(([before, after], index) => {
      if (index > 0) changes.append(', ');
      changes.append(element('code', before + ' → ' + after));
    });
    changes.append('.');
  }
  item.append(changes);
  if (!turn.clauseWords.length) return;
  const line = element('p', undefined, 'token-line');
  appendTokens(line, turn.clauseWords, (word, index) => {
    const changed = word !== turn.sourceWords[turn.clauseStart + index];
    const fragment = document.createDocumentFragment();
    appendWordTiles(fragment, inlineWords(word), changed ? 'swapped' : undefined);
    return fragment;
  });
  item.append(line);
}

function patternLine(tokens) {
  const line = element('p', undefined, 'pattern-line');
  if (tokens.length === 1 && tokens[0] === '0') {
    line.textContent = 'Accepts any wording.';
    return line;
  }

  let phrase = [];
  function addPart(text, type = '') {
    if (line.hasChildNodes()) line.append(' ');
    const part = element('span', text, 'pattern-part');
    if (type) part.classList.add(type);
    line.append(part);
  }
  for (const token of tokens) {
    if (!/^[\d(]/.test(token)) {
      phrase.push(token);
      continue;
    }
    if (phrase.length) {
      addPart(inlineWords(phrase.join(' ')), 'literal');
      phrase = [];
    }
    if (token === '0') addPart('any words', 'flexible');
    else if (/^\d+$/.test(token)) addPart(token + (token === '1' ? ' word' : ' words'), 'flexible');
    else if (token.startsWith('(*')) addPart(inlineWords(token.slice(2, -1).trim().split(/\s+/).join(' or ')));
    else if (token.startsWith('(/')) addPart('a ' + token.slice(2, -1).trim().toLowerCase() + ' word');
  }
  if (phrase.length) addPart(inlineWords(phrase.join(' ')), 'literal');
  return line;
}

function ruleList(keyword, rules, matchedIndex) {
  if (rules.length < 2) return null;

  const details = element('details', undefined, 'rule-list');
  const rows = element('ol');
  rows.setAttribute('role', 'list');
  rules.forEach((rule, index) => {
    const pattern = rule.decomposition.slice(1, -1);
    const row = element('li');
    row.append(element('span', 'Rule ' + (index + 1), 'rule-position'), ' ');
    if (index === matchedIndex) {
      row.className = 'selected-rule';
      row.append(element('strong', '★ Matched', 'match-tag'), ' ');
    }
    row.append(patternLine(pattern.match(/\([^()]*\)|[^\s()]+/g)));
    rows.append(row);
  });
  details.append(element('summary', 'All ' + rules.length + ' rules for “' + inlineWords(keyword) + '”'), rows);
  return details;
}

function patternExample(tokens, components) {
  const example = element('div', undefined, 'pattern-example');
  const formal = element('p', undefined, 'token-line formal-pattern');
  const captured = element('p', undefined, 'token-line matched-sentence');
  const multipart = tokens.length > 1;
  if (multipart) captured.classList.add('has-parts');
  formal.append('(');
  tokens.forEach((token, index) => {
    const number = index + 1;
    const pattern = element('code', token, 'pattern-token');
    pattern.dataset.matchPart = String(number);
    pattern.title = 'Part ' + number;
    if (index) formal.append(' ');
    formal.append(pattern);

    const part = element('span', undefined, 'matched-segment');
    const fragment = components[index];
    if (multipart) {
      const label = element('span', 'Part ' + number, 'part-label');
      label.dataset.matchPart = String(number);
      part.append(label, ' ');
    }
    const words = element('span', undefined, 'matched-words');
    if (fragment) appendWordTiles(words, inlineWords(fragment), number);
    else {
      const empty = element('span', 'No words', 'word-token empty-part');
      empty.dataset.matchPart = String(number);
      words.append(empty);
    }
    part.append(words);
    if (index) captured.append(' ');
    captured.append(part);
  });
  formal.append(')');
  example.append(element('p', 'DOCTOR pattern', 'pattern-label'), formal);
  if (tokens.includes('0')) {
    const note = element('p', undefined, 'notation-note');
    note.append(element('code', '0'), ' matches any number of words, including none.');
    example.append(note);
  }
  if (tokens.some(token => token.startsWith('(*'))) {
    const note = element('p', undefined, 'notation-note');
    note.append(element('code', '*'), ' before a list means match one word from that list.');
    example.append(note);
  }
  const evidence = element('div', undefined, 'matched-evidence');
  evidence.append(element('p', multipart ? 'Matched parts, numbered from left to right' : 'Words matched by this rule', 'pattern-label'), captured);
  example.append(evidence);
  return example;
}

function showPattern(list, turn, match) {
  const item = step(list, 'Match the pattern');
  const fallback = turn.steps.some(event => event.kind === 'none');
  const recall = turn.steps.find(event => event.kind === 'memory-recall');
  if (recall) {
    item.append('The memory queue supplies this turn.');
    return;
  }

  const routing = turn.steps.filter(event => ['goto', 'pre', 'newkey'].includes(event.kind));
  routing.forEach(event => {
    const line = element('p', undefined, 'step-detail');
    if (event.kind === 'goto') {
      const inputAlias = keywordEntries.get(event.from)?.link === event.to &&
        turn.keystack.some(candidate => candidate.word === event.from);
      if (inputAlias) {
        line.append('Input keyword ', element('strong', '“' + inlineWords(event.from) + '”'), '. The DOCTOR script uses the ',
          element('strong', '“' + inlineWords(event.to) + '”'), ' rule group for that keyword.');
      } else {
        line.append('The ', element('code', event.from), ' rule group continues in the ', element('code', event.to), ' rule group.');
      }
    } else if (event.kind === 'pre') {
      line.append(element('code', event.from), ' rewrites the clause for ', element('code', event.to), '.');
    } else line.append(element('code', event.from), ' moves on to the next keyword.');
    item.append(line);
    if (event.kind === 'pre' && event.rebuilt.length) {
      const rewritten = element('p', undefined, 'token-line');
      appendWordTiles(rewritten, inlineWords(event.rebuilt.join(' ')));
      item.append(rewritten);
    }
  });

  if (fallback || !match) {
    item.append(element('strong', 'No match → General reply', 'fallback-path'));
    return;
  }

  const winner = element('div', undefined, 'matched-rule');
  const header = element('p', undefined, 'match-heading');
  const rules = keywordEntries.get(match.keyword)?.transforms ?? [];
  const matchedPattern = '(' + match.rawPattern.join(' ') + ')';
  const matchedIndex = rules.findIndex(rule => rule.decomposition === matchedPattern);
  header.append(element('strong', '★ Matched rule', 'match-tag'), ' ', element('span', 'Rule group “' + inlineWords(match.keyword) + '”'));
  if (matchedIndex >= 0) header.append(' ', element('strong', 'Rule ' + (matchedIndex + 1) + ' of ' + rules.length, 'rule-position'));
  const anyWording = match.rawPattern.length === 1 && match.rawPattern[0] === '0';
  const condition = patternLine(match.rawPattern);
  if (!anyWording) condition.prepend(element('span', 'Looks for', 'pattern-label'), ' ');
  winner.append(header, condition, patternExample(match.rawPattern, match.components));
  item.append(winner);
  const allRules = ruleList(match.keyword, rules, matchedIndex);
  if (allRules) item.append(allRules);
}

function displayTemplate(tokens) {
  return displayReply(tokens.map(token => /^\d+$/.test(token) ? '[' + token + ']' : token).join(' '));
}

function showReplyOptions(item, build, general) {
  const {replyOptions, selectedReply} = build;
  const count = replyOptions.length;
  const title = general
    ? count + ' general replies'
    : count + (count === 1 ? ' reply option' : ' reply options');
  const heading = element('p', undefined, 'reply-options-heading');
  heading.append(element('strong', title), ' ',
    element('span', 'Option ' + selectedReply + ' used this turn', 'match-tag'));
  item.append(heading);
  if (count > 1) item.append(element('p', 'The script cycles through the rule’s options in order.', 'step-detail'));

  const list = element('ol', undefined, 'reply-options');
  list.setAttribute('role', 'list');
  replyOptions.forEach((option, index) => {
    const row = element('li');
    const text = displayTemplate(option);
    const selected = index + 1 === selectedReply;
    const sentence = element('p');
    if (selected) {
      row.className = 'chosen-reply';
      row.setAttribute('aria-current', 'true');
    }
    if (general && selected) {
      sentence.className = 'token-line';
      appendWordTiles(sentence, text);
    } else {
      sentence.textContent = text;
    }
    row.append(element('span', 'Option ' + (index + 1), 'reply-option-number'), ' ', sentence);
    list.append(row);
  });
  if (general) item.append(list);
  else {
    const details = element('details', undefined, 'trace-more');
    details.append(element('summary', 'View reply options'), list);
    item.append(details);
  }
}

function showReplyAssembly(item, turn, build, reply) {
  if (turn.steps.some(event => event.kind === 'memory-recall')) {
    item.append('The reply uses the oldest line saved from an earlier turn.');
  }
  if (build) {
    const line = element('p', undefined, 'token-line');
    appendWordTiles(line, displayTemplate(build.template));
    item.append(element('p', 'Template', 'token-caption'), line);
  }

  const slots = build ? [...new Set(build.template.filter(token => /^\d+$/.test(token)))] : [];
  if (slots.length) {
    slots.forEach(slot => {
      const result = element('p', undefined, 'token-line');
      const reused = build.components[Number(slot) - 1];
      const reference = element('code', '[' + slot + ']', 'pattern-token');
      reference.dataset.matchPart = slot;
      result.append(reference, ' inserts part ' + slot + ' of the match, which is ');
      if (reused) appendWordTiles(result, inlineWords(reused), Number(slot));
      else result.append(element('em', '(empty)', 'empty-part'));
      item.append(result);
    });
  } else if (build) {
    item.append(element('p', 'This template has no slots to fill.', 'step-detail'));
  }

  const output = element('p', undefined, 'token-line');
  if (build && slots.length && build.output === turn.output.replace(/\s+([,?.!])/g, '$1')) {
    const segments = build.template.map(token => /^\d+$/.test(token) ? build.components[Number(token) - 1] : token);
    const visibleSegments = segments.filter(Boolean).join(' ');
    if (displayReply(visibleSegments) === reply) {
      let cursor = 0;
      build.template.forEach((token, index) => {
        const segment = segments[index];
        if (!segment) return;
        const start = reply.toLowerCase().indexOf(segment.toLowerCase(), cursor);
        if (start < 0) return;
        appendWordTiles(output, reply.slice(cursor, start));
        appendWordTiles(output, reply.slice(start, start + segment.length), /^\d+$/.test(token) ? Number(token) : undefined);
        cursor = start + segment.length;
      });
      appendWordTiles(output, reply.slice(cursor));
    }
  }
  if (!output.hasChildNodes()) appendWordTiles(output, reply);
  item.append(element('p', 'Reply', 'token-caption'), output);
}

function showBuild(list, turn, build, reply) {
  const item = step(list, 'Build the reply');
  const general = turn.steps.some(event => event.kind === 'none');
  const hasOptions = build?.selectedReply > 0;
  if (hasOptions) showReplyOptions(item, build, general);
  if (!general || !hasOptions) showReplyAssembly(item, turn, build, reply);
  const stored = turn.steps.filter(event => event.kind === 'memory-store');
  if (stored.length) {
    const memory = element('details', undefined, 'trace-more');
    memory.append(element('summary', 'Memory saved for later'));
    stored.forEach(event => {
      const line = element('p', undefined, 'token-line');
      appendWordTiles(line, displayReply(event.text));
      memory.append(line);
    });
    item.append(memory);
  }
}

function createTrace(turn, reply) {
  const steps = element('ol', undefined, 'steps');
  steps.setAttribute('role', 'list');
  const build = turn.steps.findLast(event => event.kind === 'reassemble');
  const match = turn.steps.findLast(event => event.kind === 'decompose');
  const {reveal, result, matchedButtons, dictionaryEntries} = showKeywords(steps, turn);
  showRewrites(steps, turn);
  showPattern(steps, turn, match);
  showBuild(steps, turn, build, reply);

  const blocks = [...steps.children];
  blocks.forEach((block, index) => {
    block.hidden = index > 0;
    const nextBlock = blocks[index + 1];
    if (!nextBlock) return;
    const next = element('button', 'Next step', 'secondary trace-action');
    next.type = 'button';
    next.hidden = index === 0;
    block.querySelector('.step-body').append(next);
    next.addEventListener('click', () => {
      nextBlock.hidden = false;
      next.hidden = true;
      nextBlock.querySelector('h3').focus({preventScroll:true});
      nextBlock.scrollIntoView({block:'nearest'});
    });
    if (index === 0) {
      reveal.addEventListener('click', () => {
        matchedButtons.forEach(([button, word]) => {
          button.dataset.check = 'found';
          dictionaryEntries.get(word).classList.add('keyword-found');
        });
        result.hidden = false;
        next.hidden = false;
        reveal.hidden = true;
        result.tabIndex = -1;
        result.focus({preventScroll:true});
      });
    }
  });
  return steps;
}

function renderTurn(turn) {
  const reply = displayReply(turn.output);
  const trace = createTrace(turn, reply);
  const number = log.querySelectorAll('.turn').length + 1;
  const block = element('article', undefined, 'turn');
  const inputBubble = element('div', undefined, 'message your-message');
  const replyBubble = element('div', undefined, 'message eliza-message');
  const explain = element('button', 'Explain', 'text-button explain-reply');
  explain.type = 'button';
  explain.setAttribute('aria-label', 'Explain reply ' + number);
  explain.setAttribute('aria-controls', 'reply-explanation');
  function selectExplanation() {
    activeExplanationButton?.removeAttribute('aria-current');
    activeExplanationButton = explain;
    explain.setAttribute('aria-current', 'true');
    byId('explained-reply').textContent = 'Reply ' + number;
    traceBody.replaceChildren(trace);
    explanation.hidden = false;
  }
  explain.addEventListener('click', () => {
    selectExplanation();
    byId('trace-title').focus({preventScroll:true});
    explanation.scrollIntoView({block:'start'});
  });
  inputBubble.append(element('span', 'You', 'speaker'), element('p', turn.input));
  replyBubble.append(element('span', 'ELIZA', 'speaker'), element('p', reply));
  const replyRow = element('div', undefined, 'reply-row');
  replyRow.append(replyBubble, explain);
  block.append(inputBubble, replyRow);
  byId('starter')?.remove();
  log.append(block);
  selectExplanation();
  log.scrollTop += block.getBoundingClientRect().top - log.getBoundingClientRect().top - 12;
}

function chooseTab(tab) {
  tabs.forEach(candidate => {
    const selected = candidate === tab;
    candidate.setAttribute('aria-selected', selected);
    candidate.tabIndex = selected ? 0 : -1;
    byId(candidate.getAttribute('aria-controls')).hidden = !selected;
  });
}

async function send(text) {
  const input = text.trim();
  if (!input || pending) return;
  const status = byId('chat-status');
  pending = true;
  pendingControls.forEach(button => { button.disabled = true; });
  byId('clear-chat').disabled = true;
  status.textContent = '';
  try {
    const turn = await engine.trace(input);
    renderTurn(turn);
    message.value = '';
  } catch (error) {
    console.error(error);
    status.textContent = 'ELIZA could not answer this message. Try it again.';
    status.classList.add('error');
  } finally {
    pending = false;
    pendingControls.forEach(button => { button.disabled = false; });
    byId('clear-chat').disabled = !log.querySelector('.turn');
    if (!byId('chat-panel').hidden) message.focus({preventScroll:true});
  }
}

function parseTemplate(text, partCount) {
  if (!/^(?:[A-Za-z '’.,!?-]|\[[1-9]\d*\])+$/.test(text) || !/[a-z]|\[\d+\]/i.test(text)) return null;
  const tokens = text.toUpperCase().replaceAll('’', "'").match(/\[[1-9]\d*\]|[A-Z'-]+|[,.!?]/g);
  if (tokens.some(token => token === 'NEWKEY')) return null;
  if (tokens.some(token => token.startsWith('[') && Number(token.slice(1, -1)) > partCount)) return null;
  return tokens.map(token => token.startsWith('[') ? token.slice(1, -1) : token);
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => chooseTab(tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const wrapped = (index + direction + tabs.length) % tabs.length;
    const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : wrapped];
    chooseTab(next);
    next.focus();
  });
});

syncDictionary();
byId('try-workflow').addEventListener('click', () => {
  chooseTab(tabs[0]);
  tabs[0].focus();
  send(WORKFLOW_SAMPLE);
});

byId('chat-form').addEventListener('submit', event => {
  event.preventDefault();
  send(message.value);
});

examples.forEach(button => button.addEventListener('click', () => send(button.dataset.example)));

byId('clear-chat').addEventListener('click', () => {
  engine = makeEngine();
  userRules.forEach(({pattern,reply}, keyword) => engine.addRule(keyword, pattern, reply));
  ruleEdits.forEach((group, keyword) => {
    group.forEach(({pattern,reply}, index) => engine.editRule(keyword, index, pattern, reply));
  });
  keywordAliases.forEach((words, keyword) => engine.editAliases(keyword, words));
  syncDictionary();
  const starter = element('p', 'Write a message or try an example.', 'starter');
  starter.id = 'starter';
  log.replaceChildren(starter);
  activeExplanationButton = null;
  traceBody.replaceChildren();
  explanation.hidden = true;
  byId('chat-status').textContent = '';
  byId('clear-chat').disabled = true;
  message.value = '';
  message.focus();
});

const editForm = byId('script-form');
const addForm = byId('add-rule-form');
const groupSelect = byId('edit-group');
const ruleSelect = byId('edit-rule');
const editCondition = byId('edit-condition');
const addCondition = byId('add-condition');
const wordPattern = /^[A-Z][A-Z0-9]*(?:['-][A-Z0-9]+)*$/;

function editorStatus(id, text, error = false) {
  const status = byId(id);
  status.textContent = text;
  status.classList.toggle('error', error);
}

function patternTokens(pattern) {
  return pattern.slice(1, -1).match(/\([^()]*\)|[^\s()]+/g);
}

function editorPattern(mode, phrase) {
  if (mode === 'original') return null;
  if (mode === 'any') return ['0'];
  const words = phrase.trim().toUpperCase().replaceAll('’', "'").split(/\s+/);
  return words.every(word => wordPattern.test(word)) ? ['0', ...words, '0'] : null;
}

function replyHint(id, size, mode, example = '') {
  byId(id).textContent = example || (size === 1
    ? 'Use [1] to reuse the wording matched by this rule.'
    : mode === 'contains'
      ? 'Use [1] for the words before your phrase or [' + size + '] for the words after it.'
      : 'Use [1] through [' + size + '] to reuse a matched part. Parts are numbered from left to right.');
}

function refreshEditCondition() {
  const original = originalGroups.get(groupSelect.value).transforms[Number(ruleSelect.value)];
  const mode = editCondition.value;
  const pattern = editorPattern(mode, byId('edit-phrase').value);
  byId('edit-phrase-field').hidden = mode !== 'contains';
  byId('edit-condition-help').textContent = mode === 'original'
    ? 'The reply below updates this rule’s first option.'
    : 'A changed pattern uses the reply below.';
  const notation = element('p', undefined, 'help');
  notation.append('Original pattern ', element('code', original.decomposition));
  byId('edit-pattern').replaceChildren(patternLine(pattern || patternTokens(original.decomposition)), notation);
  const example = mode === 'original' && groupSelect.value === 'I' && ruleSelect.value === '9'
    ? 'Parts are numbered from left to right. For “I feel happy.”, [4] inserts “happy” into the reply.'
    : mode === 'original' && groupSelect.value === 'YOU' && ruleSelect.value === '2'
      ? 'Parts are numbered from left to right. For “You surprised me.”, [3] inserts “surprised” into the reply.'
      : '';
  replyHint('template-help', (pattern || patternTokens(original.decomposition)).length, mode, example);
}

function refreshAddCondition() {
  const mode = addCondition.value;
  byId('add-phrase-field').hidden = mode !== 'contains';
  const pattern = editorPattern(mode, byId('add-phrase').value);
  replyHint('add-template-help', (pattern || ['0']).length, mode);
}

function loadSelectedRule() {
  const keyword = groupSelect.value;
  const index = Number(ruleSelect.value);
  const edit = ruleEdits.get(keyword)?.get(index);
  const active = keywordEntries.get(keyword).transforms[index].reassembly[0];
  editCondition.value = edit?.mode || 'original';
  byId('edit-phrase').value = edit?.phrase || '';
  byId('template').value = /^(?:=|\(|NEWKEY$)/.test(active) ? '' : displayTemplate(active.split(' '));
  const sample = keyword === 'I' && index === 9 ? STARTER
    : keyword === 'YOU' && index === 2 ? WORKFLOW_SAMPLE
    : keyword === 'COMPUTER' ? 'I use a computer for homework.'
    : userRules.get(keyword)?.test || '';
  byId('edit-test').value = sample;
  refreshEditCondition();
}

function loadSelectedGroup(preferredIndex = 0) {
  const keyword = groupSelect.value;
  byId('edit-aliases').value = (keywordAliases.get(keyword) || []).join(', ');
  ruleSelect.replaceChildren(...keywordEntries.get(keyword).transforms.map((rule, index) => {
    const description = patternLine(patternTokens(rule.decomposition));
    const parts = [...description.children].map(part =>
      part.classList.contains('literal') ? '“' + part.textContent + '”' : part.textContent);
    const option = element('option', 'Rule ' + (index + 1) + ' · ' + (parts.length ? parts.join(' + ') : description.textContent));
    option.value = String(index);
    return option;
  }));
  ruleSelect.selectedIndex = preferredIndex;
  loadSelectedRule();
}

function loadGroupList(keyword, index = 0) {
  groupSelect.replaceChildren(...[...originalGroups.keys()].sort().map(name => {
    const option = element('option', name);
    option.value = name;
    return option;
  }));
  groupSelect.value = keyword;
  loadSelectedGroup(index);
}

function saveAndTry(test, status, confirmation) {
  editorStatus(status, confirmation);
  if (test.trim()) {
    chooseTab(tabs[0]);
    send(test);
  }
}

function availableKeyword(word, allowed = []) {
  return wordPattern.test(word) && !['BUT','NONE','MEMORY'].includes(word) &&
    (!keywordEntries.has(word) || allowed.includes(word));
}

document.querySelectorAll('[name="script-mode"]').forEach(control => {
  control.addEventListener('change', () => {
    editForm.hidden = control.value !== 'edit';
    addForm.hidden = control.value !== 'add';
  });
});
groupSelect.addEventListener('change', () => {
  loadSelectedGroup(groupSelect.value === 'I' ? 9 : groupSelect.value === 'YOU' ? 2 : 0);
  editorStatus('script-status', '');
});
ruleSelect.addEventListener('change', () => {
  loadSelectedRule();
  editorStatus('script-status', '');
});
editCondition.addEventListener('change', refreshEditCondition);
byId('edit-phrase').addEventListener('input', refreshEditCondition);
addCondition.addEventListener('change', refreshAddCondition);
byId('add-phrase').addEventListener('input', refreshAddCondition);

editForm.addEventListener('submit', event => {
  event.preventDefault();
  if (pending) return;
  const keyword = groupSelect.value;
  const index = Number(ruleSelect.value);
  const mode = editCondition.value;
  const phrase = byId('edit-phrase').value.trim();
  const pattern = editorPattern(mode, phrase);
  const baseline = originalGroups.get(keyword).transforms[index];
  const aliases = [...new Set(byId('edit-aliases').value.toUpperCase().replaceAll('’', "'").split(',').map(word => word.trim()).filter(Boolean))];
  if (!aliases.every(word => availableKeyword(word, keywordAliases.get(keyword) || []))) {
    editorStatus('script-status', 'Enter unused single words, separated by commas.', true);
    return;
  }
  if (mode === 'contains' && !pattern) {
    editorStatus('script-status', 'Enter the words the rule should match.', true);
    return;
  }
  const size = (pattern || patternTokens(baseline.decomposition)).length;
  const reply = parseTemplate(byId('template').value.trim(), size);
  if (!reply) {
    editorStatus('script-status', 'Use English text and only the reply slots shown above.', true);
    return;
  }
  if (!ruleEdits.has(keyword)) ruleEdits.set(keyword, new Map());
  ruleEdits.get(keyword).set(index, {mode, phrase, pattern, reply});
  keywordAliases.set(keyword, aliases);
  engine.editAliases(keyword, aliases);
  engine.editRule(keyword, index, pattern, reply);
  syncDictionary();
  const test = byId('edit-test').value;
  loadGroupList(keyword, index);
  byId('edit-test').value = test;
  saveAndTry(test, 'script-status', 'Changes saved.');
});

byId('restore-template').addEventListener('click', () => {
  if (pending) return;
  const keyword = groupSelect.value;
  const index = Number(ruleSelect.value);
  ruleEdits.get(keyword)?.delete(index);
  engine.editRule(keyword, index, null, null);
  syncDictionary();
  loadSelectedGroup(index);
  editorStatus('script-status', 'This rule and its replies have been restored.');
});

addForm.addEventListener('submit', event => {
  event.preventDefault();
  if (pending) return;
  const keyword = byId('add-keyword').value.trim().toUpperCase().replaceAll('’', "'");
  const pattern = editorPattern(addCondition.value, byId('add-phrase').value);
  if (!availableKeyword(keyword) || !pattern) {
    editorStatus('add-status', 'Enter an unused single keyword and complete the rule.', true);
    return;
  }
  const reply = parseTemplate(byId('add-reply').value.trim(), pattern.length);
  if (!reply) {
    editorStatus('add-status', 'Use English text and only the reply slots shown above.', true);
    return;
  }
  const test = byId('add-test').value;
  userRules.set(keyword, {pattern, reply, test});
  engine.addRule(keyword, pattern, reply);
  syncDictionary();
  originalGroups.set(keyword, keywordEntries.get(keyword));
  loadGroupList(keyword);
  saveAndTry(test, 'add-status', keyword + ' rule added.');
});

loadGroupList('I', 9);
refreshAddCondition();
