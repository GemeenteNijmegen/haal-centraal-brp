
export async function handler(event: any):Promise<any> {

  // Step 1: Extract the token from the Authorization header
  const token = event.authorizationToken;

  // Log the received token for debugging purposes
  console.log('Received Token:', token);

  // Step 2: Validate if the token is exactly "dummy"
  if (token === 'dummy') {
    // Step 3: If the token is "dummy", return an Allow policy
    return generatePolicy('user', 'Allow', event.methodArn);
  } else {
    // If the token is not "dummy", return a Deny policy
    return generatePolicy('user', 'Deny', event.methodArn);
  }
};

// Helper function to generate an IAM policy
function generatePolicy(principalId: string, effect: string, resource: string) {
  const policyDocument = {
    Version: '2012-10-17',
    Statement: [{
      Action: 'execute-api:Invoke',
      Effect: effect,
      Resource: resource,
    }],
  };
  return {
    principalId: principalId,
    policyDocument: policyDocument,
  };
}
