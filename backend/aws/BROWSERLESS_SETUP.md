# Browserless AWS Setup

## Instance Details

- **Instance ID**: `i-09e83866e4ae5eeb2`
- **Instance Type**: `t2.micro` (Free Tier eligible)
- **Public IP**: `54.163.48.64`
- **Public DNS**: `ec2-54-163-48-64.compute-1.amazonaws.com`
- **Security Group**: `sg-03e37a07ae916d868` (ports 22, 80, 443, 3000 open)
- **Key Pair**: `Canvas-Wrapper`

## Getting the Browserless Token

The instance is currently initializing (Docker installation takes ~2-3 minutes). Once ready:

1. **SSH into the instance**:
   ```bash
   ssh -i ~/.ssh/Canvas-Wrapper.pem ec2-user@54.163.48.64
   ```

2. **Get the token**:
   ```bash
   cat /home/ec2-user/browserless-token.txt
   ```

3. **Verify browserless is running**:
   ```bash
   sudo docker ps
   ```

## Environment Variables for Your Backend

Once you have the token, set these in your backend `.env`:

```bash
BROWSERLESS_WS=ws://54.163.48.64:3000/playwright
BROWSERLESS_HTTP=http://54.163.48.64:3000
BROWSERLESS_TOKEN=<token-from-instance>
```

## Connection URLs

- **WebSocket (Playwright)**: `ws://54.163.48.64:3000/playwright?token=YOUR_TOKEN`
- **HTTP Viewer**: `http://54.163.48.64:3000/devtools?token=YOUR_TOKEN`

## Production Setup (Optional)

For production with HTTPS:

1. **Get a domain** pointing to `54.163.48.64`
2. **Install nginx** on the instance:
   ```bash
   sudo yum install -y nginx
   ```
3. **Set up SSL** with Let's Encrypt:
   ```bash
   sudo yum install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```
4. **Configure nginx** to proxy to browserless on port 3000
5. **Update env vars** to use `https://your-domain.com`

## Cost

- **EC2 t2.micro**: Free for 750 hours/month (first 12 months)
- **Data transfer**: Minimal cost for typical usage
- **Total**: ~$0/month on free tier

## Management Commands

**Stop instance**:
```bash
aws ec2 stop-instances --instance-ids i-09e83866e4ae5eeb2
```

**Start instance**:
```bash
aws ec2 start-instances --instance-ids i-09e83866e4ae5eeb2
```

**Get new IP** (if stopped/started):
```bash
aws ec2 describe-instances --instance-ids i-09e83866e4ae5eeb2 --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
```

**View instance logs**:
```bash
aws ec2 get-console-output --instance-id i-09e83866e4ae5eeb2
```

## Troubleshooting

If browserless isn't running:
```bash
ssh -i ~/.ssh/Canvas-Wrapper.pem ec2-user@54.163.48.64
sudo docker logs browserless
sudo docker restart browserless
```
