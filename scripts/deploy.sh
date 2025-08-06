#!/bin/bash

# This script contains functions related to building, pushing, and deploying the application.
# It should be sourced by the main go.sh script.

# Source necessary dependencies
# Resolve script directory relative to the sourced script location
_DEPLOY_SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
source "$_DEPLOY_SCRIPT_DIR/install.sh" || { echo "Error: Failed to source install.sh" >&2; exit 1; }
source "$_DEPLOY_SCRIPT_DIR/templating.sh" || { echo "Error: Failed to source templating.sh" >&2; exit 1; }

#======================================
# Obfuscation Functions
#======================================

# Function to obfuscate JavaScript files
obfuscate_js() {
    local src_dir="$1"
    local dest_dir="$2"
    
    echo "Obfuscating JavaScript files..." >&2
    
    # Check if uglify-js is available
    if ! command -v uglifyjs &> /dev/null; then
        echo "Installing uglify-js for JavaScript obfuscation..."
        sudo npm install -g uglify-js || { echo "Error: Failed to install uglify-js" >&2; return 1; }
    fi
    
    # Find and obfuscate all JS files
    find "$src_dir" -name "*.js" -type f | while read -r js_file; do
        local rel_path="${js_file#$src_dir/}"
        local dest_file="$dest_dir/$rel_path"
        local dest_file_dir="$(dirname "$dest_file")"
        
        mkdir -p "$dest_file_dir"
        
        echo "Obfuscating: $rel_path" >&2
        uglifyjs "$js_file" --compress --mangle --output "$dest_file" || {
            echo "Warning: Failed to obfuscate $js_file, copying as-is" >&2
            cp "$js_file" "$dest_file"
        }
    done
}

# Function to minify CSS files
minify_css() {
    local src_dir="$1"
    local dest_dir="$2"
    
    echo "Minifying CSS files..." >&2
    
    # Find and minify all CSS files
    find "$src_dir" -name "*.css" -type f | while read -r css_file; do
        local rel_path="${css_file#$src_dir/}"
        local dest_file="$dest_dir/$rel_path"
        local dest_file_dir="$(dirname "$dest_file")"
        
        mkdir -p "$dest_file_dir"
        
        echo "Minifying: $rel_path" >&2
        # Simple CSS minification - remove comments, extra whitespace, newlines
        sed 's/\/\*.*\*\///g' "$css_file" | \
        tr -d '\n\r' | \
        sed 's/[[:space:]]\+/ /g' | \
        sed 's/; /;/g' | \
        sed 's/{ /{/g' | \
        sed 's/} /}/g' | \
        sed 's/: /:/g' > "$dest_file"
    done
}

# Function to minify HTML files
minify_html() {
    local src_dir="$1"
    local dest_dir="$2"
    
    echo "Minifying HTML files..." >&2
    
    # Find and minify all HTML files
    find "$src_dir" -name "*.html" -type f | while read -r html_file; do
        local rel_path="${html_file#$src_dir/}"
        local dest_file="$dest_dir/$rel_path"
        local dest_file_dir="$(dirname "$dest_file")"
        
        mkdir -p "$dest_file_dir"
        
        echo "Minifying: $rel_path" >&2
        # Simple HTML minification - remove comments and extra whitespace
        sed 's/<!--.*-->//g' "$html_file" | \
        sed 's/[[:space:]]\+/ /g' | \
        sed 's/> </></g' > "$dest_file"
    done
}

# Function to obfuscate the entire src directory
obfuscate_src() {
    local src_dir="$_DEPLOY_SCRIPT_DIR/../src"
    local temp_obfuscated_dir="$_DEPLOY_SCRIPT_DIR/../.obfuscated"
    
    echo "Creating obfuscated version of src directory..." >&2
    
    # Clean and create temp directory
    rm -rf "$temp_obfuscated_dir"
    mkdir -p "$temp_obfuscated_dir"
    
    # Copy non-script files first
    find "$src_dir" -type f ! -name "*.js" ! -name "*.css" ! -name "*.html" | while read -r file; do
        local rel_path="${file#$src_dir/}"
        local dest_file="$temp_obfuscated_dir/$rel_path"
        local dest_file_dir="$(dirname "$dest_file")"
        
        mkdir -p "$dest_file_dir"
        cp "$file" "$dest_file"
    done
    
    # Obfuscate/minify specific file types
    obfuscate_js "$src_dir" "$temp_obfuscated_dir"
    minify_css "$src_dir" "$temp_obfuscated_dir"
    minify_html "$src_dir" "$temp_obfuscated_dir"
    
    echo "Obfuscation complete. Files available in: $temp_obfuscated_dir" >&2
    echo "$temp_obfuscated_dir"
}

#======================================
# Staging Functions
#======================================

# Function to clean specified remote directories
clean_remote() {
    local instance_name="$1"
    local instance_zone="$2"

    if [ -z "$instance_name" ] || [ -z "$instance_zone" ]; then
        echo "Error: Instance name and zone must be provided to clean_remote." >&2
        return 1
    fi

    local remote_commands="
        sudo rm -rf /tmp/apache_deploy/*; \
        sudo mkdir -p /tmp/apache_deploy; \
        if [ \$? -eq 0 ]; then \
            echo 'Remote deployment directory cleaned successfully.'; \
        else \
            echo 'Error: Failed to clean remote deployment directory.' >&2; \
            exit 1; \
        fi; \
    "

    gcloud compute ssh "$instance_name" --zone "$instance_zone" --command="$remote_commands"
    local gcloud_status=$?

    if [ $gcloud_status -ne 0 ]; then
        echo "Error: Remote cleaning failed. Exit code: $gcloud_status. Check output above." >&2
        return 1
    fi

    return 0
}

# Function to start the local Apache server (development mode)
stage_local() {
    local deployment_name="$1"
    local src_dir="$_DEPLOY_SCRIPT_DIR/../src"
    local web_root="/var/www/html"
    
    echo "Starting local Apache server for deployment: $deployment_name"
    
    # Check if Apache is installed locally
    if ! command -v apache2 &> /dev/null; then
        echo "Apache is not installed locally. Installing..."
        sudo apt-get update && sudo apt-get install -y apache2 || {
            echo "Error: Failed to install Apache locally" >&2
            return 1
        }
    fi
    
    # Create obfuscated files
    local obfuscated_dir
    obfuscated_dir=$(obfuscate_src) || {
        echo "Error: Failed to obfuscate source files" >&2
        return 1
    }
    
    # Copy obfuscated files to web root
    echo "Deploying obfuscated files to local web root..."
    sudo rm -rf "$web_root"/* || true
    
    # Copy static files if they exist - maintain directory structure
    if [ -d "$obfuscated_dir/static" ]; then
        sudo cp -r "$obfuscated_dir/static" "$web_root/" 2>/dev/null || {
            echo "Warning: No static files found to copy" >&2
        }
    fi
    
    # Copy template files if they exist - maintain directory structure for templates/ but copy index.html to root
    if [ -d "$obfuscated_dir/templates" ]; then
        # Create templates directory to maintain URL structure
        sudo mkdir -p "$web_root/templates"
        
        # Copy all template files to maintain /templates/ path structure
        sudo cp -r "$obfuscated_dir/templates"/* "$web_root/templates/" 2>/dev/null || {
            echo "Warning: No template files found to copy" >&2
        }
        
        # Also copy index.html to root level for direct access
        if [ -f "$obfuscated_dir/templates/index.html" ]; then
            sudo cp "$obfuscated_dir/templates/index.html" "$web_root/" 2>/dev/null || {
                echo "Warning: Failed to copy index.html to root" >&2
            }
        fi
    fi
    
    # Set proper permissions
    sudo chown -R www-data:www-data "$web_root"
    sudo chmod -R 755 "$web_root"
    
    # Start Apache
    sudo systemctl enable apache2
    sudo systemctl start apache2 || {
        echo "Error: Failed to start Apache locally" >&2
        return 1
    }
    
    echo "Local Apache server started successfully"
    echo "Access your site at: http://localhost"
    
    # Cleanup
    rm -rf "$obfuscated_dir"
    return 0
}

# Function to deploy files to remote server and run start.sh
stage_remote() {
    local instance_name="$1"
    local instance_zone="$2"
    local deployment_name="$3"
    
    [ -z "$instance_name" ] && { echo "Error: Instance name is required for stage_remote." >&2; return 1; }
    [ -z "$instance_zone" ] && { echo "Error: Instance zone is required for stage_remote." >&2; return 1; }
    [ -z "$deployment_name" ] && { echo "Error: Deployment name is required for stage_remote." >&2; return 1; }

    echo "Deploying to remote server: $instance_name in zone $instance_zone"
    
    # Clean the remote deployment directory
    clean_remote "$instance_name" "$instance_zone" || {
        echo "Error: Failed to clean remote directory." >&2
        return 1
    }

    # Create obfuscated files
    local obfuscated_dir
    obfuscated_dir=$(obfuscate_src) || {
        echo "Error: Failed to obfuscate source files" >&2
        return 1
    }

    # Prepare deployment package
    local temp_deploy_dir=$(mktemp -d)
    local src_dir="$_DEPLOY_SCRIPT_DIR/../src"
    
    # Copy start.sh (the provisioning script)
    cp "$src_dir/start.sh" "$temp_deploy_dir/provision.sh" || {
        echo "Error: Failed to copy start.sh" >&2
        rm -rf "$temp_deploy_dir" "$obfuscated_dir"
        return 1
    }
    
    # Copy all obfuscated files (static, templates, etc.)
    if [ -d "$obfuscated_dir" ]; then
        # Copy static files if they exist
        if [ -d "$obfuscated_dir/static" ]; then
            cp -r "$obfuscated_dir/static" "$temp_deploy_dir/" || {
                echo "Error: Failed to copy obfuscated static files" >&2
                rm -rf "$temp_deploy_dir" "$obfuscated_dir"
                return 1
            }
        fi
        
        # Copy templates files if they exist
        if [ -d "$obfuscated_dir/templates" ]; then
            cp -r "$obfuscated_dir/templates" "$temp_deploy_dir/" || {
                echo "Error: Failed to copy obfuscated template files" >&2
                rm -rf "$temp_deploy_dir" "$obfuscated_dir"
                return 1
            }
        fi
    fi

    # Create .htaccess file in the temp deployment directory
    cat > "$temp_deploy_dir/.htaccess" <<'EOF'
RewriteEngine On

# Serve files if they exist
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d

# Specific rewrites for legal pages
RewriteRule ^privacy/?$ /templates/privacy.html [L]
RewriteRule ^tos/?$ /templates/tos.html [L]

# Fallback to index.html for SPA-style routing, ONLY if the request is not for an existing file
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^(.*)$ /index.html [L]
EOF
    log "Created .htaccess file for deployment."
    
    # Create deployment config
    cat > "$temp_deploy_dir/deploy_config.json" <<EOF
{
  "deployment_name": "$deployment_name",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "type": "apache_static",
  "domain": "$CFG_EXTERNAL_URL",
  "ssl_email": "$CFG_SSL_EMAIL"
}
EOF

    # Create deployment script
    cat > "$temp_deploy_dir/deploy.sh" <<'EOF'
#!/bin/bash
set -euo pipefail

DEPLOY_DIR="/tmp/apache_deploy"
WEB_ROOT="/var/www/html"

echo "Starting Apache deployment..."

# Make provision script executable and run it
chmod +x "$DEPLOY_DIR/provision.sh"
sudo "$DEPLOY_DIR/provision.sh"

echo "Apache deployment completed successfully!"
EOF

    # Package everything
    local tarball="/tmp/apache_deploy.tar.gz"
    tar czf "$tarball" -C "$temp_deploy_dir" . || {
        echo "Error: Failed to create deployment tarball" >&2
        rm -rf "$temp_deploy_dir" "$obfuscated_dir"
        return 1
    }

    # Copy tarball to remote
    echo "Uploading deployment package..."
    gcloud compute scp "$tarball" "$instance_name:/tmp/apache_deploy.tar.gz" --zone "$instance_zone" || {
        echo "Error: Failed to upload deployment package" >&2
        rm -rf "$temp_deploy_dir" "$obfuscated_dir" "$tarball"
        return 1
    }

    # Extract and run deployment on remote
    local remote_deploy_cmd="
        cd /tmp && \
        sudo mkdir -p /tmp/apache_deploy && \
        sudo tar xzf apache_deploy.tar.gz -C /tmp/apache_deploy && \
        sudo chmod +x /tmp/apache_deploy/deploy.sh && \
        sudo /tmp/apache_deploy/deploy.sh && \
        sudo cp /tmp/apache_deploy/.htaccess /var/www/html/
    "
    
    echo "Executing deployment on remote server..."
    gcloud compute ssh "$instance_name" --zone "$instance_zone" --command="$remote_deploy_cmd" || {
        echo "Error: Failed to execute deployment on remote server" >&2
        rm -rf "$temp_deploy_dir" "$obfuscated_dir" "$tarball"
        return 1
    }

    # Cleanup
    rm -rf "$temp_deploy_dir" "$obfuscated_dir" "$tarball"

    # Show appropriate final message based on URL type
    if [[ "$CFG_EXTERNAL_URL" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "Remote deployment completed successfully!"
        echo "Access your site at: http://$CFG_EXTERNAL_URL"
    else
        echo "Remote deployment completed successfully!"
        echo "Access your site at: https://$CFG_EXTERNAL_URL"
        echo "Note: SSL certificate will be automatically configured by Let's Encrypt"
    fi
    return 0
}

#======================================
# Build Functions (Simplified for Static Deployment)
#======================================

# Function to prepare static files (replaces Docker build)
prepare_static() {
    local deployment_type="$1"
    local deployment_name="$2"
    
    echo "Preparing static files for $deployment_type deployment..."
    
    # Create obfuscated files
    local obfuscated_dir
    obfuscated_dir=$(obfuscate_src) || {
        echo "Error: Failed to prepare static files" >&2
        return 1
    }
    
    echo "Static files prepared successfully in: $obfuscated_dir"
    
    # For local development, we might want to keep files for inspection
    if [ "$deployment_type" == "local" ]; then
        local backup_dir="$_DEPLOY_SCRIPT_DIR/../.local_build"
        rm -rf "$backup_dir"
        cp -r "$obfuscated_dir" "$backup_dir"
        echo "Local build backup saved to: $backup_dir"
    fi
    
    # Cleanup temp obfuscated directory
    rm -rf "$obfuscated_dir"
    return 0
}

#======================================
# Terraform Functions (Simplified)
#======================================

# Function to run Terraform init, plan, and apply
terraform_update() {
    local confirm_tf_apply="$1"
    local terraform_dir="$_DEPLOY_SCRIPT_DIR/../terraform"
    local tf_exit_code=0

    echo "Running Terraform update for Apache server..."

    ( # Start subshell for Terraform
        cd "$terraform_dir" || { echo "Error: Could not change directory to '$terraform_dir'." >&2; exit 1; }
        terraform init -upgrade || { echo "Error: Terraform initialization failed." >&2; exit 1; }
        echo "Terraform initialized."
        terraform plan -out=tfplan || { echo "Error: Terraform plan generation failed." >&2; rm -f tfplan; exit 1; }
        echo "The Terraform plan was generated and saved to '$terraform_dir/tfplan'."
        local tf_apply_status=1
        echo "--------------------------------------------------"
        echo "Review the generated plan using: terraform show tfplan"
        
        # Check if there are any changes in the plan
        local has_changes=$(terraform show -no-color tfplan | grep -q 'No changes.'; echo $?)
        if [ $has_changes -eq 0 ]; then
            echo "No changes detected in Terraform plan. Skipping apply."
            tf_apply_status=0
        elif [[ "$confirm_tf_apply" =~ ^[Yy] ]]; then
            echo "Proceeding with Terraform apply based on user confirmation..."
            terraform apply tfplan
            tf_apply_status=$?
            [ $tf_apply_status -ne 0 ] && echo "Error: Terraform apply command failed (Exit Code: $tf_apply_status)." >&2
        else
            echo "Terraform apply was skipped based on user confirmation." >&2
            tf_apply_status=2 # Specific user cancel/skip status
        fi
        echo "--------------------------------------------------"
        rm -f tfplan
        exit $tf_apply_status
    ) # End subshell
    tf_exit_code=$?

    # Return the exit code from the subshell
    return $tf_exit_code
}

# Function to destroy Terraform-managed infrastructure
terraform_destroy() {
    local confirm_tf_destroy="$1"
    local terraform_dir="$_DEPLOY_SCRIPT_DIR/../terraform"
    local tf_exit_code=0

    echo "Attempting to destroy remote infrastructure..."

    if [[ ! "$confirm_tf_destroy" =~ ^[Yy] ]]; then
        echo "Terraform destroy was cancelled by user." >&2
        return 2 # Specific user cancel status
    fi

    echo "WARNING: This will destroy all infrastructure defined in $terraform_dir managed by Terraform." >&2
    echo "Proceeding with Terraform destroy based on user confirmation..."

    ( # Start subshell for Terraform
        cd "$terraform_dir" || { echo "Error: Could not change directory to '$terraform_dir'." >&2; exit 1; }
        terraform init -upgrade || { echo "Error: Terraform initialization failed." >&2; exit 1; }
        echo "Terraform initialized."

        terraform destroy -auto-approve
        tf_exit_code=$?
        [ $tf_exit_code -ne 0 ] && echo "Error: Terraform destroy command failed (Exit Code: $tf_exit_code)." >&2

        exit $tf_exit_code
    ) # End subshell
    tf_exit_code=$?

    if [ $tf_exit_code -eq 0 ]; then
        echo "Terraform destroy completed successfully."
    else
        echo "Terraform destroy failed." >&2
    fi

    # Return the exit code from the subshell
    return $tf_exit_code
}

#======================================
# Main Deployment Function
#======================================

# Function to run the full deployment process
deploy() {
    local deployment_type="$1"
    local deployment_name="${2:-apache-server}"
    local confirm_tf_apply="${3:-n}"
    
    [ -z "$deployment_type" ] && { echo "Error: Deployment type is required." >&2; return 1; }

    echo "Starting Apache deployment process..."
    echo "Type: $deployment_type"
    echo "Name: $deployment_name"

    # Ensure required tools are installed
    echo "Checking required tools..."
    check_nodejs || { echo "Error: Node.js installation failed." >&2; return 1; }
    
    if [ "$deployment_type" == "local" ]; then
        check_apache || { echo "Error: Apache installation failed." >&2; return 1; }
    elif [ "$deployment_type" == "remote" ]; then
        check_terraform || { echo "Error: Terraform installation failed." >&2; return 1; }
    fi

    # Configure deployment files (templating)
    echo "Configuring deployment files..."
    template_files "$deployment_type" "$deployment_name" "y" || {
        echo "Error: File templating failed." >&2
        return 1
    }

    if [ "$deployment_type" == "local" ]; then
        # Local deployment
        stage_local "$deployment_name" || {
            echo "Error: Local deployment failed." >&2
            return 1
        }
        echo "Local Apache deployment completed successfully!"
        
    elif [ "$deployment_type" == "remote" ]; then
        # Remote deployment
        
        # Run Terraform if confirmed
        if [[ "$confirm_tf_apply" =~ ^[Yy] ]]; then
            terraform_update "$confirm_tf_apply" || {
                echo "Error: Terraform deployment failed." >&2
                return 1
            }
        else
            echo "Skipping Terraform operations (not confirmed)."
        fi
        
        # Get instance details from Terraform output
        local instance_name=""
        local instance_zone="us-central1-a"
        
        if command -v terraform &>/dev/null && [ -f "$_DEPLOY_SCRIPT_DIR/../terraform/terraform.tfstate" ]; then
            instance_name=$(cd "$_DEPLOY_SCRIPT_DIR/../terraform" && terraform output -raw instance_name 2>/dev/null || echo "")
            instance_zone=$(cd "$_DEPLOY_SCRIPT_DIR/../terraform" && terraform output -raw instance_zone 2>/dev/null || echo "$instance_zone")
        fi
        
        if [ -z "$instance_name" ]; then
            echo "Error: Could not determine instance name from Terraform output." >&2
            return 1
        fi
        
        # Deploy to remote server
        stage_remote "$instance_name" "$instance_zone" "$deployment_name" || {
            echo "Error: Remote deployment failed." >&2
            return 1
        }
        
        # Access information is already shown by stage_remote function
    else
        echo "Error: Invalid deployment type '$deployment_type'. Use 'local' or 'remote'." >&2
             return 1
    fi

    return 0
}

# Export functions to make them available in the shell scope
export -f prepare_static
export -f stage_remote
export -f stage_local
export -f terraform_update
export -f terraform_destroy
export -f deploy
export -f obfuscate_src

# Minimal execution logic if called directly (for sourcing verification)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "This script (${BASH_SOURCE[0]}) is intended to be sourced. Use the main 'go.sh' script instead." >&2
    exit 1
fi
