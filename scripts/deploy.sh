#!/bin/bash

# This script contains functions related to building and deploying the application to Firebase.
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

# Function to obfuscate the entire src directory into a destination directory
obfuscate_src() {
    local src_dir="$1"
    local dest_dir="$2"
    
    [ -z "$src_dir" ] && { echo "Error: Source directory is required for obfuscate_src." >&2; return 1; }
    [ -z "$dest_dir" ] && { echo "Error: Destination directory is required for obfuscate_src." >&2; return 1; }

    echo "Creating obfuscated version of $src_dir in $dest_dir..." >&2
    
    # Clean and create destination directory
    rm -rf "$dest_dir"
    mkdir -p "$dest_dir"
    
    # Copy non-script files first
    find "$src_dir" -type f ! -name "*.js" ! -name "*.css" ! -name "*.html" | while read -r file; do
        local rel_path="${file#$src_dir/}"
        local dest_file="$dest_dir/$rel_path"
        local dest_file_dir="$(dirname "$dest_file")"
        
        mkdir -p "$dest_file_dir"
        cp "$file" "$dest_file"
    done
    
    # Obfuscate/minify specific file types
    obfuscate_js "$src_dir" "$dest_dir"
    minify_css "$src_dir" "$dest_dir"
    minify_html "$src_dir" "$dest_dir"
    
    echo "Obfuscation and minification complete. Files available in: $dest_dir" >&2
}

#======================================
# Deployment Functions
#======================================

# Function to prepare the public directory for deployment
prepare_deployment() {
    local deployment_type="$1"
    local src_dir="$_DEPLOY_SCRIPT_DIR/../src"
    local public_dir="$_DEPLOY_SCRIPT_DIR/../public"
    
    echo "Preparing public directory for $deployment_type deployment..."
    
    # 1. Clean and recreate public directory
    rm -rf "$public_dir"
    
    # 2. Handle deployment directory based on type
    if [ "$deployment_type" == "remote" ]; then
        echo "Creating obfuscated version of $src_dir in $public_dir..."
        mkdir -p "$public_dir"
        obfuscate_src "$src_dir" "$public_dir" || return 1
        # 3. Generate the dynamic config.js directly into public/static/
        template_files "$deployment_type" "$public_dir" "y" || return 1
    else
        # For local, use a symlink to src for live updates
        echo "Creating symlink from $src_dir to $public_dir for live updates..."
        ln -s "$src_dir" "$public_dir"
        # 3. Generate the dynamic config.js directly into src/static/
        # This ensures the emulator sees the correct local config
        template_files "$deployment_type" "$src_dir" "y" || return 1
    fi
    
    echo "Public directory prepared successfully in: $public_dir"
    return 0
}

# Function to run the full deployment process
deploy() {
    local deployment_type="$1"
    local deployment_name="${2:-website}"
    
    [ -z "$deployment_type" ] && { echo "Error: Deployment type is required." >&2; return 1; }

    echo "Starting Firebase deployment process..."
    echo "Type: $deployment_type"
    echo "Name: $deployment_name"

    # Ensure required tools are installed
    echo "Checking required tools..."
    check_nodejs || { echo "Error: Node.js installation failed." >&2; return 1; }
    check_firebase_cli || { echo "Error: Firebase CLI setup failed." >&2; return 1; }

    if [ "$deployment_type" == "remote" ]; then
        local project_id="$CFG_GCP_PROJECT_ID"
        [ -z "$project_id" ] && { echo "Error: GCP project ID is not set in config.json." >&2; return 1; }
        
        echo "Using GCP project from config: $project_id"
        
        # Ensure Firebase Hosting APIs are enabled
        echo "Ensuring Firebase Hosting APIs are enabled for project '$project_id'..."
        gcloud services enable firebase.googleapis.com firebasehosting.googleapis.com --project "$project_id" || {
            echo "Error: Failed to enable Firebase APIs." >&2
            return 1
        }

        # Ensure project and site are initialized (idempotent, using REST API for robust checks)
        local site_name="servercult"
        echo "Ensuring project '$project_id' and site '$site_name' are initialized..."
        
        local token
        token=$(gcloud auth print-access-token)

        # 1. Check if project is initialized for Firebase
        local proj_status
        proj_status=$(curl -s -o /dev/null -w "%{http_code}" -X GET "https://firebase.googleapis.com/v1beta1/projects/$project_id" \
             -H "Authorization: Bearer $token" \
             -H "X-Goog-User-Project: $project_id")

        if [ "$proj_status" == "404" ]; then
            echo "Project '$project_id' is not a Firebase project. Initializing..."
            firebase projects:addfirebase "$project_id" --non-interactive || { echo "Error: Failed to initialize Firebase project." >&2; return 1; }
        elif [ "$proj_status" != "200" ]; then
            echo "Error: Unexpected API response ($proj_status) while checking project status." >&2
            return 1
        fi

        # 2. Check if hosting site exists
        local site_status
        site_status=$(curl -s -o /dev/null -w "%{http_code}" -X GET "https://firebasehosting.googleapis.com/v1beta1/projects/$project_id/sites/$site_name" \
             -H "Authorization: Bearer $token" \
             -H "X-Goog-User-Project: $project_id")

        if [ "$site_status" == "404" ]; then
            echo "Site '$site_name' not found. Creating it..."
            firebase hosting:sites:create "$site_name" --project "$project_id" --non-interactive || { echo "Error: Failed to create hosting site." >&2; return 1; }
        elif [ "$site_status" != "200" ]; then
            echo "Error: Unexpected API response ($site_status) while checking site status." >&2
            return 1
        fi

        # Disable the default site if it's not our target
        if [ "$project_id" != "$site_name" ]; then
            echo "Ensuring default site '$project_id' is disabled..."
            firebase hosting:disable --site "$project_id" --project "$project_id" --force 2>/dev/null || true
        fi
    fi

    # Prepare the public directory (Obfuscate + Template)
    # This now happens AFTER Firebase setup for remote
    prepare_deployment "$deployment_type" || {
        echo "Error: Failed to prepare deployment files." >&2
        return 1
    }

    #======================================
    # GrapesJS Studio SDK Build Step
    #======================================
    local website_dir="$_DEPLOY_SCRIPT_DIR/.."
    echo "Building GrapesJS Studio SDK bundle..." >&2
    if [ -f "$website_dir/package.json" ]; then
        # Ensure local dependencies are installed
        ( cd "$website_dir" && npm install ) || { echo "Error: npm install failed." >&2; return 1; }
        
        if [ "$deployment_type" == "local" ]; then
            echo "Performing initial SDK build..." >&2
            ( cd "$website_dir" && npm run build:sdk ) || { echo "Error: Initial SDK build failed." >&2; return 1; }
            
            echo "Starting SDK watcher in background..." >&2
            ( cd "$website_dir" && npm run watch:sdk ) &
        else
            echo "Running production SDK build..." >&2
            ( cd "$website_dir" && npm run build:sdk ) || { echo "Error: Failed to build SDK bundle." >&2; return 1; }
        fi
        echo "SDK build process completed/initialized." >&2
    else
        echo "Warning: package.json not found, skipping SDK build." >&2
    fi

    if [ "$deployment_type" == "local" ]; then
        local active_port="${CFG_LOCAL_HTTP_PORT:-5000}"
        echo "Starting local Firebase emulator on port $active_port..."
        ( cd "$_DEPLOY_SCRIPT_DIR/.." && firebase serve --only hosting --port "$active_port" )
    elif [ "$deployment_type" == "remote" ]; then
        local project_id="$CFG_GCP_PROJECT_ID"
        echo "Deploying to Firebase Hosting..."
        ( cd "$_DEPLOY_SCRIPT_DIR/.." && firebase deploy --only hosting --project "$project_id" )
        echo "Deployment successful!"
        
        # Ensure custom domains are configured
        if [ -n "$CFG_EXTERNAL_URL" ]; then
            echo "Ensuring custom domains are configured for site '$site_name'..."
            IFS=',' read -ra ADDR <<< "$CFG_EXTERNAL_URL"
            for domain in "${ADDR[@]}"; do
                domain=$(echo "$domain" | xargs) # trim whitespace
                domain="${domain#*://}"
                # Attempt to create the custom domain mapping (ignore errors if it already exists)
                curl -s -X POST "https://firebasehosting.googleapis.com/v1beta1/projects/$project_id/sites/$site_name/customDomains?customDomainId=$domain" \
                     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
                     -H "X-Goog-User-Project: $project_id" \
                     -H "Content-Type: application/json" \
                     -d "{
                       \"name\": \"projects/$project_id/sites/$site_name/customDomains/$domain\"
                     }" > /dev/null
            done

            # Get all domains for the site in one go
            echo "Retrieving DNS verification records for all domains..."
            local domains_json
            domains_json=$(curl -s -X GET "https://firebasehosting.googleapis.com/v1beta1/projects/$project_id/sites/$site_name/customDomains" \
                 -H "Authorization: Bearer $(gcloud auth print-access-token)" \
                 -H "X-Goog-User-Project: $project_id")

            echo "--------------------------------------------------"
            echo "REQUIRED DNS RECORDS"
            echo "--------------------------------------------------"
            
            local show_verify=false
            
            # Extract records for all domains from the list response
            echo "$domains_json" | jq -c '.customDomains[]?' | while read -r domain_obj; do
                local main_domain
                main_domain=$(echo "$domain_obj" | jq -r '.name | split("/") | last')
                
                echo "DOMAIN: $main_domain"
                
                # 1. Main required DNS updates
                local main_records
                main_records=$(echo "$domain_obj" | jq -c '.requiredDnsUpdates.desired[].records[]?' 2>/dev/null)
                if [ -n "$main_records" ]; then
                    echo "$main_records" | while read -r record; do
                        [ -z "$record" ] && continue
                        local action
                        action=$(echo "$record" | jq -r '.requiredAction // "VERIFY"')
                        if [ "$show_verify" == "true" ] || [ "$action" == "ADD" ]; then
                            local type val host
                            type=$(echo "$record" | jq -r '.type')
                            val=$(echo "$record" | jq -r '.rdata')
                            host=$(echo "$record" | jq -r '.domainName')
                            
                            echo "Type: $type"
                            echo "Host: $host"
                            echo "Value: $val"
                            echo "Action: $action"
                            echo "---"
                        fi
                    done
                fi

                # 2. SSL/Cert verification records
                local cert_records
                cert_records=$(echo "$domain_obj" | jq -c '.cert.verification.dns.desired[].records[]?' 2>/dev/null)
                if [ -n "$cert_records" ]; then
                    echo "$cert_records" | while read -r record; do
                        [ -z "$record" ] && continue
                        local action
                        action=$(echo "$record" | jq -r '.requiredAction // "ADD"')
                        if [ "$show_verify" == "true" ] || [ "$action" == "ADD" ]; then
                            local type val host
                            type=$(echo "$record" | jq -r '.type')
                            val=$(echo "$record" | jq -r '.rdata')
                            host=$(echo "$record" | jq -r '.domainName')
                            
                            echo "Type: $type"
                            echo "Host: $host"
                            echo "Value: $val"
                            echo "Action: $action"
                            echo "---"
                        fi
                    done
                fi
                echo "--------------------------------------------------"
            done
        fi
    else
        echo "Error: Invalid deployment type '$deployment_type'. Use 'local' or 'remote'." >&2
        return 1
    fi

    return 0
}

# Export functions to make them available in the shell scope
export -f deploy
export -f prepare_deployment
export -f obfuscate_src
export -f obfuscate_js
export -f minify_css
export -f minify_html

# Minimal execution logic if called directly (for sourcing verification)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "This script (${BASH_SOURCE[0]}) is intended to be sourced. Use the main 'go.sh' script instead." >&2
    exit 1
fi
