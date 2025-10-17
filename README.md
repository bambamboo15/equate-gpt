# EquateGPT

EquateGPT is ChatGPT with the capability to do basic math via tooling. This project demonstrates the use of:
 * LangGraph JS API and good workflow
 * TypeScript, Node.js, Express.js, Socket.io
 * Frontend design such as automatic markdown and LaTeX formatting
 * Usage of HTML, CSS, JS
 * Token streaming for better output and more pleasant UX
 * Some tooling for more mathematical accuracy
 * LLM being able to call tools while responding instead of just calling beforehand
 * Some error handling for more robustness

This is pretty basic, as conversations are non-persistent and can be broken without the user knowing. This has also not been tested on multiple users at once. However, this project supports the case where the single user maintains a connection with the server, which is enough for a course project.

## Instructions to run
Internet and the latest NodeJS release is required. There may be other dependencies. In the current directory, do `npm install` then `npm run start`. The website will then run in `localhost:3000`.