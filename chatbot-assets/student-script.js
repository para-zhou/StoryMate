'use strict';

// Edit the classroom conversation here using the same patterns and slots as the editor.
window.ElizaStudentScript = [
  {
    keyword: 'HELLO',
    words: ['hello', 'hi', 'hey'],
    precedence: 1,
    rules: [
      {pattern: '*', replies: [
        'Hi! What school subject or hobby would you like to talk about?',
        'Hello! Tell me about something you are learning or making.'
      ]}
    ]
  },
  {
    keyword: 'SCHOOL',
    words: ['school', 'class', 'lesson', 'homework', 'math', 'science', 'history'],
    precedence: 12,
    rules: [
      {pattern: '* my favorite subject is [slot 1]', replies: [
        'What is one interesting thing you learned in [slot 1]?',
        'If you could teach a short lesson about [slot 1], what would you show?'
      ]},
      {pattern: '*', replies: [
        'What is something interesting you learned recently?',
        'What would make that subject more fun to learn?',
        'If you could design a class activity, what would it be?'
      ]}
    ]
  },
  {
    keyword: 'PROJECT',
    words: ['project', 'projects', 'presentation', 'poster', 'experiment'],
    precedence: 20,
    rules: [
      {pattern: '* my project is about [slot 1]', replies: [
        'What would you like classmates to learn about [slot 1]?',
        'What could you show to illustrate [slot 1]?'
      ]},
      {pattern: '*', replies: [
        'What is the next step in that project?',
        'Would a sketch or a small prototype help you try out that idea?',
        'What would you like someone to notice about your project?'
      ]}
    ]
  },
  {
    keyword: 'COMPUTER',
    words: ['computer', 'computers', 'laptop', 'laptops'],
    precedence: 24,
    rules: [
      {pattern: '* I use [slot 1] for [slot 2]', replies: [
        'What is one way [slot 1] helps with [slot 2]?',
        'What would you do differently if you had to do [slot 2] without a computer?'
      ]},
      {pattern: '*', replies: [
        'What would you like to make with a computer?',
        'What job would you give a computer in a school project?'
      ]}
    ]
  },
  {
    keyword: 'HOBBY',
    words: ['hobby', 'hobbies', 'drawing', 'music', 'reading', 'sports', 'game', 'games'],
    precedence: 10,
    rules: [
      {pattern: '* I like [slot 1]', replies: [
        'How would you introduce [slot 1] to someone who is new to it?',
        'What is a fun way to get started with [slot 1]?'
      ]},
      {pattern: '*', replies: [
        'What do you enjoy most about that activity?',
        'What would you tell a friend who wants to try it?'
      ]}
    ]
  },
  {
    keyword: 'I',
    words: ['I', "I'm"],
    precedence: 0,
    rules: [
      {pattern: '* I [am/feel] [slot 1: happy/excited/proud/curious] *', replies: [
        'Feeling [slot 1] can be a great start to a new project. What would you like to try?',
        'Can you think of a fictional character who also feels [slot 1]?'
      ]},
      {pattern: "* I'm [slot 1: happy/excited/proud/curious] *", replies: [
        'Can you think of a fictional character who also feels [slot 1]?',
        'If a character felt [slot 1], what might they do next?'
      ]},
      {pattern: '* I want to learn about [slot 1]', replies: [
        'What is one question you have about [slot 1]?',
        'Where could you look for a good introduction to [slot 1]?'
      ]},
      {pattern: '*', replies: [
        'Thanks for sharing. Would you like to talk about a hobby or a school project?',
        'Try a made-up example about something you would like to learn or make.'
      ]}
    ]
  },
  {
    keyword: 'NONE',
    words: [],
    precedence: 0,
    rules: [
      {pattern: '*', replies: [
        'Could you say that another way?',
        'Try telling me about a school project or something you enjoy.',
        'Would you like to try one of the example messages?'
      ]}
    ]
  }
];
