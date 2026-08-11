const fs = require('node:fs');
const path = require('node:path');

const TERRAFORM_MAIN = path.join(
  __dirname,
  '..',
  '..',
  'cloud-infrastructure',
  'terraform',
  'modules',
  'api-gateway',
  'main.tf',
);

function activeTerraformLines(terraformMain) {
  return terraformMain
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

describe('Terraform API Gateway module (scaffold only)', () => {
  const terraformMain = fs.readFileSync(TERRAFORM_MAIN, 'utf8');
  const activeTf = activeTerraformLines(terraformMain);

  it('documents scaffold-only scope in main.tf', () => {
    expect(terraformMain).toMatch(/SCAFFOLD ONLY/i);
    expect(terraformMain).toMatch(/does NOT create aws_apigatewayv2_route/i);
  });

  it('provisions APIs and stages but no live routes or integrations', () => {
    expect(activeTf).toMatch(/resource\s+"aws_apigatewayv2_api"\s+"public"/);
    expect(activeTf).toMatch(/resource\s+"aws_apigatewayv2_stage"\s+"public"/);
    expect(activeTf).toMatch(/resource\s+"aws_apigatewayv2_api"\s+"internal"/);
    expect(activeTf).toMatch(/resource\s+"aws_apigatewayv2_stage"\s+"internal"/);
    expect(activeTf).not.toMatch(/resource\s+"aws_apigatewayv2_integration"/);
    expect(activeTf).not.toMatch(/resource\s+"aws_apigatewayv2_route"/);
  });
});
