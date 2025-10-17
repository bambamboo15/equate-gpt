/**
 * This backend abstracts away AI functionality.
 * 
 * STUDENT NOTE:
 *   Even though this is a TypeScript project, this is really the only file
 *   that makes heavy use of TypeScript features. I do this because it aligns
 *   with the LangChain examples and it makes debugging so much easier.
 */
import { StateGraph, Annotation } from "@langchain/langgraph";
import { BaseMessage, HumanMessage, AIMessage, SystemMessage, AIMessageChunk } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool, tool } from "@langchain/core/tools";
import { concat as streamConcat } from "@langchain/core/utils/stream";
import { ToolMessage } from "@langchain/core/messages/tool";
import { z } from "zod";                        // as it turns out, you need
                                                // version 3.25.67 of Zod for
                                                // this to work with LangChain
import { v4 as uuidv4 } from "uuid";
import Algebrite from "algebrite";

// The numerical expression evaluator tool.
const numericalExpressionEvaluatorTool = tool(
    async ({ expression }): Promise<string> => {
        try {
            return Algebrite.eval(expression).toString();
        } catch (e: any) {
            return e.toString();
        }
    },
    {
        name: "numerical_expression_eval",
        description: `
            Performs numerical expression evaluation equivalent to running:

            \`\`\`
            Algebrite.run(EXPRESSION).toString()
            \`\`\`

            In Algebrite, negative numbers must be parenthesized, e.g., \`(-2)\`.
            Algebrite may not support the full range of whatever you are calculating!
        `,
        schema: z.object({
            expression: z.string()
        })
    }
);

// Chunk callback type for streaming
type ChunkCallback = (chunk: string | undefined) => void;

/**
 * There should be one instance of this class per user session.
 * Holds chat messages and provides methods specific to this project.
 */
export class UserSession {
    readonly model = this.__construct_model();
    readonly graph = this.__construct_state_graph();

    messages: BaseMessage[] = [
        new SystemMessage(`
            You're EquateGPT, a math-savvy assistant ready to help users solve equations, explore algebra, and tackle any math problem step by step.
            You're a sophisticated AI, but you're not perfect (try to be as perfect as possible). Math doesn't have much room for mistakes. Be careful!

            If you run into a calculation during your answer and you're unsure, then you should:
              - Call relevant tool calls
              - Wait for tool call responses
              - Resume your response exactly from where you left off.
            
            Math is precise, so if you ever notice that you've erred, don't be afraid to apologize and reveal it!
            You can use tool calls however much you want, even in the middle of a response! Please use it as much as you can!
            Use tool calls as much as you can, even intermediate steps in computations! Just be aware that your responses will be stacked like sandwiches on top of each other!
            Please don't be so overconfient, like a glaringly wrong answer not matching a tool call. Please admit your mistakes and apologize.

            You can use tool calls even in the middle of a response, interrupting, like this example:
                We need to calculate [NUM1] x [NUM2] + [NUM3]

                1. Calculate the product [NUM1] x [NUM2]: [NUM4 := NUM1 x NUM2]
                2. Calculate the addition [NUM4] + [NUM3]: [NUM5 := NUM4 + NUM3]
            but there is a tool call beforehand to calculate [NUM1 x NUM2] and a tool call between list items 1 and 2 to calculate [NUM4 + NUM3] if needed.

            The example below is BAD because no tool calls are being done for these gigantic numbers:
                1. First, we calculate \(138128939823 \times 1238912738917\):
                    \[
                    138128939823 \times 1238912738917 = 171129703159814403191691
                    \]

                    2. Next, we subtract \(99999999444444\) from the result:
                    \[
                    171129703159814403191691 - 99999999444444
                    \]

                    Now, let's perform that subtraction:

                    \[
                    171129703159814403191691 - 99999999444444 = 171129703159714403191691
                    \]
            
            Please don't go doing huge calculations by yourself because that's sooo error prone, you can interrupt the flow, don't worry! Extremely simple calculations you can do yourself. For example:

              - \\( 3553368960 \\times 20 \\) SHOULD result in a tool call
              - \\( 4 \\times 5 \\) SHOULDN'T
              - \\( 7 + 7 \\) SHOULDN'T
              - \\( 23 + 6 \\) SHOULDN'T
              - \\( 23 + 60 \\) MAYBE
              - \\( 123 + 456 \\) PROBABLY
              - \\( 718 - 462 \\) SHOULD
              - \\( 870912 \\times 15 \\) SHOULD

            
        `),
        new AIMessage("Hi! I'm EquateGPT, a math-savvy assistant ready to help you solve equations, explore algebra, and tackle any math problem step by step.")
    ];
    thread_id: string = uuidv4();

    __construct_model() {
        // Check if API key is loaded
        if (!process.env.OPENAI_API_KEY) {
            throw new Error("Missing required env variable: OPENAI_API_KEY");
        }

        return new ChatOpenAI({
            model: "gpt-4o-mini",
            temperature: 0.2,
            maxTokens: undefined,
            timeout: undefined,
            maxRetries: 2,
            streaming: true,
        }).bindTools([
            numericalExpressionEvaluatorTool
        ]);
    }

    __construct_state_graph() {
        // Defines state that is processed during graph execution.
        //   messages: messages are fed into this buffer through reducing upon this field
        //   onChunk: (optional) called whenever an AI response chunk comes in
        //   accumulated: LangChain message
        //   stackedResponse: response that will follow is stacked on previous
        const StateAnnotation = Annotation.Root({
            messages: Annotation<BaseMessage[]>({
                reducer: (left: BaseMessage[], right: BaseMessage[]) => left.concat(right),
                default: () => []
            }),
            onChunk: Annotation<ChunkCallback | undefined>,
            accumulated: Annotation<BaseMessage | undefined>,
            stackedResponse: Annotation<Boolean>
        });

        // The actual AgentState type
        type AgentState = typeof StateAnnotation.State;

        // Functions for graph
        const streamNode = async (state: AgentState): Promise<Partial<AgentState>> => {
            let message = "";
            let accumulated = undefined;
            let start = true;

            // Stream tokens, accumulating the full message
            for await (const chunk of await this.model.stream(state.messages)) {
                // Accumulate the message in the process
                accumulated = accumulated !== undefined
                    ? streamConcat(accumulated, chunk)
                    : chunk;
                
                // If chunk is not a tool call then output text
                if (chunk.tool_calls === undefined || chunk.tool_calls!.length === 0) {
                    // Put a <hr> between stacked responses
                    if (state.stackedResponse) {
                        state.onChunk?.("__pure__ :: <hr>");
                        state.stackedResponse = false;
                    }

                    state.onChunk?.(chunk.text);
                    message += chunk.text;
                }
            }

            console.log(`\x1b[38;2;255;75;75m\x1b[1m[AI response]\x1b[0m ${accumulated?.text}`);

            // Gather the resulting message. Put the intermediate AI tool call message text in
            // so that the AI knows that it should be continuing the response.
            let messages = [accumulated ?? new AIMessage("")];
            if (accumulated !== undefined
             && accumulated.tool_calls !== undefined
             && accumulated.tool_calls!.length !== 0)
                messages.unshift(new AIMessage(accumulated.text));
            
            // Response is real if text is actually nontrivial
            const stackedResponse = accumulated !== undefined && accumulated.text.trim().length !== 0;

            // Push the new AI message
            return { accumulated, messages, stackedResponse };
        };

        // Maps tool names to actual tools
        const nameToToolMap: Record<string, DynamicStructuredTool> = {
            "numerical_expression_eval": numericalExpressionEvaluatorTool
        };

        const toolCallNode = async (state: AgentState): Promise<Partial<AgentState>> => {
            let messages: ToolMessage[] = [];

            // Call each tool call in order
            for (const call of (state.accumulated! as AIMessageChunk).tool_calls!) {
                const tool = nameToToolMap[call.name as string];
                const output = await tool.invoke(call.args);

                console.log(`\x1b[38;2;0;150;0m\x1b[1m[Tool call invoked]\x1b[0m ${call.name}`);
                console.log(JSON.stringify(call.args));
                console.log(output.toString());

                // Push a tool call message
                messages.push(new ToolMessage({
                    content: output.toString(),
                    tool_call_id: call.id!
                }));
            }

            // Add all of the tool messages and clear all tool calls
            return { messages, accumulated: undefined };
        }

        // Construct the graph
        return new StateGraph(StateAnnotation)
            .addNode("streamNode", streamNode)
            .addNode("toolCallNode", toolCallNode)
            .addEdge("__start__", "streamNode")
            .addConditionalEdges("streamNode", (state) => state.accumulated !== undefined && (state.accumulated! as AIMessageChunk).tool_calls!.length !== 0
                ? "toolCallNode"
                : "__end__")
            .addEdge("toolCallNode", "streamNode")
            .compile({ checkpointer: new MemorySaver() });
    }

    /**
     * @throws Various internal model call exceptions.
     * @param prompt The user prompt.
     * @param onChunk Callback that takes in a chunk (of the AI response).
     * @return The AI response.
     * 
     * Streams an (EquateGPT) AI response, keeping message history.
     */
    async streamResponse(prompt: string, onChunk: ChunkCallback): Promise<string> {
        console.log(`\x1b[38;2;0;125;255m\x1b[1m[User prompt]\x1b[0m ${prompt}`);
        
        // Gather all messages including prompts and invoke model
        const state = await this.graph.invoke(
            { messages: [...this.messages, new HumanMessage(prompt)], onChunk, stackedResponse: false },
            { "configurable": { "thread_id": this.thread_id } });
        
        const response = state.messages.at(-1)!;
        const output = response.content as string;

        // Store messages to memory
        this.messages.push(new HumanMessage(prompt), response);

        return output;
    }
}