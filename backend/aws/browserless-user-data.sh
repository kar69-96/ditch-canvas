#!/bin/bash
# Install Docker
yum update -y
yum install -y docker
service docker start
usermod -a -G docker ec2-user

# Generate a secure token
BROWSERLESS_TOKEN=$(openssl rand -hex 32)

# Run browserless container
docker run -d \
  --name browserless \
  --restart unless-stopped \
  -p 3000:3000 \
  -e TOKEN=$BROWSERLESS_TOKEN \
  -e MAX_CONCURRENT_SESSIONS=2 \
  -e CONNECTION_TIMEOUT=60000 \
  browserless/chrome:latest

# Save token to a file for retrieval
echo "BROWSERLESS_TOKEN=$BROWSERLESS_TOKEN" > /home/ec2-user/browserless-token.txt
chmod 600 /home/ec2-user/browserless-token.txt

# Log the setup
echo "Browserless started with token: $BROWSERLESS_TOKEN" >> /var/log/browserless-setup.log
