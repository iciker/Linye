// Demo fixtures for the study-session flashcards/quiz.
// Real data (subjects/topics/sources/chunks/search/chat) comes from the Rust
// backend via api.ts. The old seeded cheatsheet/chat/materials/search fixtures
// were removed once those views moved to real data.

// Flashcards for the study session (Anki-style)
export const flashcards = [
  { q: "What two properties must a problem have for dynamic programming to apply?", a: "Overlapping subproblems and optimal substructure." },
  { q: "What is a base case?", a: "The smallest input solved directly without further recursion; every path must reach one." },
  { q: "Time complexity of naive vs memoized Fibonacci?", a: "Naive is O(φⁿ) (exponential); memoized is O(n)." },
  { q: "Master theorem form?", a: "T(n) = aT(n/b) + f(n) — compare f(n) with n^(log_b a)." },
  { q: "Top-down vs bottom-up DP?", a: "Memoized recursion vs iterative tabulation — equivalent; choose by stack-depth risk." },
];

// Quiz questions (multiple choice)
export const quiz = [
  {
    q: "Which pair of properties signals a dynamic-programming problem?",
    options: ["Overlapping subproblems + optimal substructure", "Greedy choice + matroid", "Divide and conquer + sorting", "Memoization + recursion only"],
    answer: 0,
    explain: "DP applies when subproblems overlap (so caching helps) and the optimum is built from sub-optima.",
  },
  {
    q: "Naive recursive Fibonacci runs in…",
    options: ["O(n)", "O(n log n)", "O(φⁿ) exponential", "O(n²)"],
    answer: 2,
    explain: "Each call branches into two, re-solving overlapping subproblems exponentially often.",
  },
  {
    q: "Bottom-up tabulation avoids which risk that top-down memoization has?",
    options: ["Cache misses", "Stack overflow from deep recursion", "Incorrect base cases", "Higher asymptotic complexity"],
    answer: 1,
    explain: "Tabulation is iterative, so there's no recursion depth to overflow the call stack.",
  },
];
