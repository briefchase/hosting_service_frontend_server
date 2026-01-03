#!/bin/bash
# Blank Apache setup for Debian/Ubuntu images (tested on Debian 11).
# Installs Apache, PHP, and Certbot. Creates a simple index.html with "hey".
# Usage: sudo bash start.sh

set -euo pipefail

CONFIG_FILE="/tmp/config.json"
DEPLOY_CONFIG_FILE="/tmp/apache_deploy/deploy_config.json"

log() { echo -e "[${DEPLOYMENT_NAME:-apache-provision}] $*"; }

ensure_jq() {
  command -v jq >/dev/null 2>&1 && return 0
  apt-get update -y && apt-get install -y jq
}

init_config() {
  ensure_jq
  
  # Try to read deployment name from deploy config first
  if [[ -f "$DEPLOY_CONFIG_FILE" ]]; then
    DEPLOYMENT_NAME=$(jq -r '.deployment_name // "apache-server"' "$DEPLOY_CONFIG_FILE")
    log "Using deployment name from config: $DEPLOYMENT_NAME"
  else
    DEPLOYMENT_NAME="apache-server"
    log "No deployment config found, using default name: $DEPLOYMENT_NAME"
  fi
  
  if [[ ! -f "$CONFIG_FILE" ]]; then
    log "Creating initial $CONFIG_FILE …"
    cat > "$CONFIG_FILE" <<JSON
{
  "deployment_name": "$DEPLOYMENT_NAME",
  "sites": [],
  "admin_email": "admin@example.com"
}
JSON
  fi

  ADMIN_EMAIL=$(jq -r '.admin_email // "admin@example.com"' "$CONFIG_FILE")
}

update_system() {
  log "Updating system packages …"
  
  # Set non-interactive frontend early
  export DEBIAN_FRONTEND=noninteractive
  export APT_LISTCHANGES_FRONTEND=none
  export NEEDRESTART_MODE=a
  
  log "Disabling installation of documentation to speed up apt."
  echo 'path-exclude /usr/share/doc/*' | tee /etc/dpkg/dpkg.cfg.d/01_nodoc
  echo 'path-exclude /usr/share/man/*' | tee -a /etc/dpkg/dpkg.cfg.d/01_nodoc
  echo 'path-exclude /usr/share/info/*' | tee -a /etc/dpkg/dpkg.cfg.d/01_nodoc
  echo 'path-exclude /usr/share/locale/*' | tee -a /etc/dpkg/dpkg.cfg.d/01_nodoc
  
  # Disable man-db triggers to prevent hanging
  log "Disabling man-db triggers to prevent hanging..."
  echo 'man-db man-db/auto-update boolean false' | debconf-set-selections
  
  log "Killing any existing apt processes to prevent locks..."
  pkill -9 -f apt || true
  rm -f /var/lib/dpkg/lock* /var/cache/apt/archives/lock /var/lib/apt/lists/lock
  dpkg --configure -a --force-confdef
  
  # Update with timeout protection
  log "Running apt-get update with timeout protection..."
  timeout 300 apt-get update -y || {
    log "Warning: apt-get update timed out, continuing anyway..."
  }
}

install_stack() {
  log "Installing Apache, PHP, and Certbot …"
  export DEBIAN_FRONTEND=noninteractive
  export APT_LISTCHANGES_FRONTEND=none
  export NEEDRESTART_MODE=a
  
  # Install packages with timeout protection
  log "Running package installation with timeout protection..."
  timeout 1800 apt-get -y \
    -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold" \
    -o Dpkg::Options::="--force-confnew" \
    install apache2 php libapache2-mod-php certbot python3-certbot-apache wget jq curl dnsutils || {
    log "Warning: Package installation timed out or failed, attempting recovery..."
    
    # Kill any hanging processes
    pkill -9 -f mandb || true
    pkill -9 -f "Building database" || true
    
    # Try to configure any partially installed packages
    dpkg --configure -a --force-confdef || true
    
    log "Continuing with service configuration..."
  }
  
  log "Enabling Apache service..."
  systemctl enable apache2
  
  log "Starting Apache service..."
  if ! systemctl start apache2; then
    log "ERROR: 'systemctl start apache2' command failed."
    systemctl status apache2 --no-pager || true
    journalctl -u apache2 -n 50 --no-pager || true
    return 1
  fi
  
  # Wait for Apache to become active
  for i in {1..10}; do
    if systemctl is-active --quiet apache2; then
      log "Apache started successfully (attempt $i)."
      break
    fi
    if [ $i -eq 10 ]; then
      log "ERROR: Apache failed to become active after 10 attempts."
      systemctl status apache2 --no-pager || true
      return 1
    fi
    log "Apache not active yet, waiting... (attempt $i/10)"
    sleep 1
  done
  
  log "Enabling Apache rewrite module..."
  a2enmod rewrite

  log "Configuring Apache to allow .htaccess overrides..."
  local apache_config="/etc/apache2/apache2.conf"
  if ! grep -q "AllowOverride All" "$apache_config"; then
      sed -i '/<Directory \/var\/www\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' "$apache_config"
      log "Enabled .htaccess overrides in $apache_config"
  else
      log ".htaccess overrides already seem to be enabled."
  fi

  systemctl restart apache2
  log "Apache configuration restarted"
}

configure_vhost() {
    local deploy_dir="/tmp/apache_deploy"
    local config_file="$deploy_dir/deploy_config.json"
    local vhost_file="/etc/apache2/sites-available/hoster.conf"

    log "Configuring Apache virtual host..."

    if [[ ! -f "$config_file" ]]; then
        log "Deployment config not found. Skipping vhost configuration."
        return 0
    fi

    local domains_str
    domains_str=$(jq -r '.domain // empty' "$config_file" 2>/dev/null || echo "")

    if [[ -z "$domains_str" ]] || [[ "$domains_str" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        log "No domain specified or IP address provided. Skipping vhost configuration."
        return 0
    fi

    IFS=',' read -ra DOMAINS <<< "$domains_str"
    local primary_domain="${DOMAINS[0]}"
    local server_aliases=""
    if [[ ${#DOMAINS[@]} -gt 1 ]]; then
        server_aliases="ServerAlias"
        for i in "${!DOMAINS[@]}"; do
            if [[ $i -gt 0 ]]; then
                server_aliases+=" ${DOMAINS[$i]}"
            fi
        done
    fi
    
    local ssl_email
    ssl_email=$(jq -r '.ssl_email // "admin@example.com"' "$config_file" 2>/dev/null)

    log "Creating new vhost config at $vhost_file"
    log "Setting ServerName to $primary_domain"
    if [[ -n "$server_aliases" ]]; then
        log "Setting $server_aliases"
    fi
    
    cat > "$vhost_file" <<EOF
<VirtualHost *:80>
    ServerAdmin $ssl_email
    DocumentRoot /var/www/html
    ServerName $primary_domain
    $server_aliases

    ErrorLog \${APACHE_LOG_DIR}/error.log
    CustomLog \${APACHE_LOG_DIR}/access.log combined
</VirtualHost>
EOF

    log "Disabling default Apache site..."
    a2dissite 000-default.conf || log "Warning: failed to disable default site."

    log "Enabling new 'hoster' site..."
    a2ensite hoster.conf || {
        log "ERROR: failed to enable hoster.conf."
        return 1
    }

    log "Reloading Apache configuration..."
    if ! systemctl reload apache2; then
        log "ERROR: 'systemctl reload apache2' command failed."
        systemctl status apache2 --no-pager || true
        journalctl -u apache2 -n 50 --no-pager || true
        return 1
    fi
}

create_index_page() {
  local deploy_dir="/tmp/apache_deploy"
  local static_dir="$deploy_dir/static"
  local templates_dir="$deploy_dir/templates"
  
  log "Setting up web content..."
  
  # Remove default Apache page
  rm -f /var/www/html/index.html
  
  # Check if we have deployed files
  local has_content=false
  
  # Copy static files first if they exist - maintain directory structure
  if [ -d "$static_dir" ] && [ "$(ls -A $static_dir 2>/dev/null)" ]; then
    log "Found deployed static files, copying to web root with directory structure..."
    
    # Copy static directory to maintain /static/ path structure
    cp -r "$static_dir" /var/www/html/ || {
      log "Error: Failed to copy static files"
    }
    
    has_content=true
    log "Deployed static files copied successfully"
  fi
  
  # Copy template files if they exist - maintain directory structure for templates/ but copy index.html to root
  if [ -d "$templates_dir" ] && [ "$(ls -A $templates_dir 2>/dev/null)" ]; then
    log "Found deployed template files, copying with proper structure..."
    
    # Create templates directory to maintain URL structure
    mkdir -p /var/www/html/templates
    
    # Copy all template files to maintain /templates/ path structure
    cp -r "$templates_dir"/* /var/www/html/templates/ || {
      log "Error: Failed to copy template files"
    }
    
    # Also copy index.html to root level for direct access
    if [ -f "$templates_dir/index.html" ]; then
      cp "$templates_dir/index.html" /var/www/html/ || {
        log "Warning: Failed to copy index.html to root"
      }
    fi
    
    has_content=true
    log "Deployed template files copied successfully"
  fi
  
  # If no content was deployed, create fallback page
  if [ "$has_content" = "false" ]; then
    log "No deployed content found, creating fallback page"
    create_fallback_page
  fi
  
  # Set proper permissions
  chown -R www-data:www-data /var/www/html/
  chmod -R 755 /var/www/html/
  
  log "Web content setup complete"
}

configure_ssl() {
  local deploy_dir="/tmp/apache_deploy"
  local config_file="$deploy_dir/deploy_config.json"
  
  # Check if we have a domain configuration
  if [ -f "$config_file" ]; then
    local domains_str=$(jq -r '.domain // empty' "$config_file" 2>/dev/null || echo "")
    local ssl_email=$(jq -r '.ssl_email // empty' "$config_file" 2>/dev/null || echo "")
    
    if [ -z "$domains_str" ] || [ -z "$ssl_email" ] || [[ "$domains_str" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      log "No domains to configure or an IP address was provided. Skipping SSL setup."
      return 0
    fi
      
    log "Performing DNS pre-flight check for domains: $domains_str"
    
    # Get server's public IP
    local server_ip
    server_ip=$(curl -s http://checkip.amazonaws.com || curl -s ifconfig.me)
    if [ -z "$server_ip" ]; then
        log "Warning: Could not determine server's public IP. Skipping SSL validation."
        return 0
    fi
    log "Server public IP: $server_ip"
    
    local valid_domains=()
    local domain_args=""
    
    IFS=',' read -ra DOMAINS <<< "$domains_str"
    for d in "${DOMAINS[@]}"; do
      local domain_ip
      domain_ip=$(dig +short "$d" A | head -n1)
      
      if [ "$domain_ip" == "$server_ip" ]; then
        log "DNS OK: '$d' points to this server ($server_ip)."
        valid_domains+=("$d")
        domain_args+=" -d $d"
      else
        log "DNS MISMATCH: '$d' points to '$domain_ip', not '$server_ip'. Skipping."
      fi
    done
    
    if [ ${#valid_domains[@]} -eq 0 ]; then
      log "No valid domains found pointing to this server. Skipping SSL configuration."
      return 0
    fi
    
    log "Configuring SSL for valid domains: ${valid_domains[*]}"
    
    # Run certbot for the validated domains
    certbot --apache --expand $domain_args --email "$ssl_email" --agree-tos --non-interactive --redirect || {
      log "Warning: Certbot failed for validated domains. Check logs for details."
      return 0 # Allow deployment to continue even if certbot fails
    }

    # After successful certificate installation, enable HSTS for HTTPS responses
    log "Enabling HSTS (1 year) on HTTPS responses..."
    a2enmod headers || true
    cat > /etc/apache2/conf-available/hsts.conf <<'APACHECONF'
<IfModule mod_headers.c>
  Header always set Strict-Transport-Security "max-age=31536000" "expr=%{HTTPS} == 'on'"
  # Note: no includeSubDomains, as 'www' is intentionally not used
</IfModule>
APACHECONF
    a2enconf hsts || true
    systemctl reload apache2 || true
  fi
  
  return 0
}

create_fallback_page() {
  log "Creating fallback page for $DEPLOYMENT_NAME..."
  
  # Create simple fallback page
  cat > /var/www/html/index.html <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>$DEPLOYMENT_NAME - Apache Server</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background-color: #f0f0f0;
        }
        .container {
            text-align: center;
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin: 0;
        }
        .info {
            color: #666;
            margin-top: 1rem;
            font-size: 0.9rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>$DEPLOYMENT_NAME</h1>
        <div class="info">
            <p>Apache server is running!</p>
            <p>Apache + PHP + Certbot</p>
        </div>
    </div>
</body>
</html>
HTML
}

main() {
  init_config
  update_system
  install_stack
  configure_vhost
  create_index_page
  configure_ssl

  log "Apache server provisioning complete!"
}

main "$@" 