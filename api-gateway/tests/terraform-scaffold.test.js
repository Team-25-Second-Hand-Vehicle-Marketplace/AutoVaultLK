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

describe('Terraform API Gateway module', () => {
  const terraformMain = fs.readFileSync(TERRAFORM_MAIN, 'utf8');
  const activeTf = activeTerraformLines(terraformMain);

  it('provisions the public and internal HTTP APIs and their $default stages', () => {
    expect(activeTf).toMatch(/resource\s+"aws_apigatewayv2_api"\s+"public"/);
    expect(activeTf).toMatch(/resource\s+"aws_apigatewayv2_stage"\s+"public"/);
    expect(activeTf).toMatch(/resource\s+"aws_apigatewayv2_api"\s+"internal"/);
    expect(activeTf).toMatch(/resource\s+"aws_apigatewayv2_stage"\s+"internal"/);
  });

  it('drives public and internal routes/integrations from their respective lambda-integration variable maps', () => {
    // One integration + two routes (bare and {proxy+}) per for_each map, for
    // each of the public and internal APIs — matching nginx's `location
    // /prefix/` also serving an exact hit on `/prefix`.
    for (const boundary of ['public', 'internal']) {
      const integrationRe = new RegExp(
        `resource\\s+"aws_apigatewayv2_integration"\\s+"${boundary}"[\\s\\S]*?for_each\\s*=\\s*var\\.${boundary}_lambda_integrations`,
      );
      expect(activeTf).toMatch(integrationRe);

      const proxyRouteRe = new RegExp(
        `resource\\s+"aws_apigatewayv2_route"\\s+"${boundary}_proxy"[\\s\\S]*?route_key\\s*=\\s*"ANY /\\$\\{each\\.key\\}/\\{proxy\\+\\}"`,
      );
      expect(activeTf).toMatch(proxyRouteRe);

      const bareRouteRe = new RegExp(
        `resource\\s+"aws_apigatewayv2_route"\\s+"${boundary}_bare"[\\s\\S]*?route_key\\s*=\\s*"ANY /\\$\\{each\\.key\\}"`,
      );
      expect(activeTf).toMatch(bareRouteRe);
    }
  });

  it('exposes the invoke URL, id and execution ARN outputs consumed by the environment composition and IAM module', () => {
    expect(activeTf).toMatch(/output\s+"public_api_endpoint"/);
    expect(activeTf).toMatch(/output\s+"internal_api_endpoint"/);
    expect(activeTf).toMatch(/output\s+"public_api_id"/);
    expect(activeTf).toMatch(/output\s+"internal_api_id"/);
    expect(activeTf).toMatch(/output\s+"public_api_execution_arn"/);
    expect(activeTf).toMatch(/output\s+"internal_api_execution_arn"/);
  });
});
