/**
 * Enables Algebrite to be imported normally.
 * This takes away Intellisense.
 */

declare module 'algebrite' {
    const Algebrite: any;
    export default Algebrite;
}