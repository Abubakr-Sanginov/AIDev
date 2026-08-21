export async function executeTool(tool, input, context) {
    const parsed = tool.schema.safeParse(input);
    if (!parsed.success) {
        return { ok: false, tool: tool.definition.name, output: '', error: parsed.error.message };
    }
    try {
        return {
            ok: true,
            tool: tool.definition.name,
            output: await tool.execute(parsed.data, context),
        };
    }
    catch (error) {
        return {
            ok: false,
            tool: tool.definition.name,
            output: '',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
