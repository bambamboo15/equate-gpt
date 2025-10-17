/**
 *   Description:    Final course project for Generative AI. This course project
 *                introduces EquateGPT, a ChatGPT model instance (not fine-tuned)
 *                that can answer math questions.
 *                   This project demonstrates use of:
 *                - LangGraph JS API and good workflow
 *                - TypeScript, Node.js, Express.js, Socket.io
 *                - Frontend design such as automatic markdown and LaTeX formatting
 *                - Token streaming for better output and more pleasant UX
 *                - Some tooling for more mathematical accuracy
 *                - LLM being able to call tools while responding
 *                - Some error handling for more robustness
 *   Assignment: Course Project
 *   Class: Generative AI
 *   Semester: Fall
 *   Student: Benyamin Bamburac
 *   Date started: 10/8/2025 7:13pm
 */
import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { UserSession } from "./backend.ts";
import serveStatic from "serve-static";
import path from "path";
import { fileURLToPath } from "url";

// There are problems with these in ES modules so they have to be reconstructed
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(serveStatic("public"))

const server = http.createServer(app);
const io = new Server(server);

// Maps each user to a backend user session object
const userSessions: Record<string, UserSession> = { };

io.on("connection", (socket) => {
    const session = new UserSession();
    userSessions[socket.id] = session;

    console.log("User connected", socket.id);

    socket.on("chat", async (prompt: string) => {
        const response = await session.streamResponse(prompt, (chunk) => {
            socket.emit("chunk", chunk);
        });

        socket.emit("chat", response);
    });

    socket.on("disconnnect", () => {
        console.log("User disconnected:", socket.id);
        delete userSessions[socket.id];
    });
});

app.use("/", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

server.listen(3000, () => console.log("Server listening on :3000"));