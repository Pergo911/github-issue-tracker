import { ESLintUtils } from "@typescript-eslint/utils";

export const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/Pergo911/github-issue-tracker/blob/main/app/eslint-rules/${name}.ts`,
);
