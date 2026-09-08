const fs = require('fs');
let code = fs.readFileSync('src/utils/upng.js', 'utf8');

// 1. Update UPNG.encode signature
code = code.replace(
  'UPNG.encode = function(bufs, w, h, ps, dels, forbidPlte)',
  'UPNG.encode = function(bufs, w, h, ps, dels, forbidPlte, edgeWeights)'
);

code = code.replace(
  'var nimg = UPNG.encode.compressPNG(bufs, w, h, ps, forbidPlte);',
  'var nimg = UPNG.encode.compressPNG(bufs, w, h, ps, forbidPlte, edgeWeights);'
);

code = code.replace(
  'UPNG.encode.compressPNG = function(bufs, w, h, ps, forbidPlte)',
  'UPNG.encode.compressPNG = function(bufs, w, h, ps, forbidPlte, edgeWeights)'
);

code = code.replace(
  'var out = UPNG.encode.compress(bufs, w, h, ps, false, forbidPlte);',
  'var out = UPNG.encode.compress(bufs, w, h, ps, false, forbidPlte, edgeWeights);'
);

code = code.replace(
  'UPNG.encode.compress = function(bufs, w, h, ps, forGIF, forbidPlte)',
  'UPNG.encode.compress = function(bufs, w, h, ps, forGIF, forbidPlte, edgeWeights)'
);

code = code.replace(
  'var qres = UPNG.quantize(bufs, ps, forGIF);',
  'var qres = UPNG.quantize(bufs, ps, forGIF, edgeWeights, w, h);'
);

code = code.replace(
  'UPNG.quantize = function(bufs, ps, roundAlpha)',
  'UPNG.quantize = function(bufs, ps, roundAlpha, edgeWeights, w, h)'
);

// 2. Pass edgeWeights to stats
code = code.replace(
  'root.bst = UPNG.quantize.stats(  nimg,root.i0, root.i1  );',
  'root.bst = UPNG.quantize.stats(  nimg,root.i0, root.i1, edgeWeights  );'
);

code = code.replace(
  'ln.bst = UPNG.quantize.stats( nimg, ln.i0, ln.i1 );',
  'ln.bst = UPNG.quantize.stats( nimg, ln.i0, ln.i1, edgeWeights );'
);

code = code.replace(
  'UPNG.quantize.stats = function(nimg, i0, i1){',
  'UPNG.quantize.stats = function(nimg, i0, i1, edgeWeights){'
);

// 3. Apply edgeWeights in stats loop
code = code.replace(
  /for\(var i=i0; i<i1; i\+=4\)\s*\{[\s\S]*?m\[0\]\+=r;  m\[1\]\+=g;  m\[2\]\+=b;  m\[3\]\+=a;/m,
  `for(var i=i0; i<i1; i+=4)
	{
		var r = nimg[i]*(1/255), g = nimg[i+1]*(1/255), b = nimg[i+2]*(1/255), a = nimg[i+3]*(1/255);
		var w = edgeWeights ? (edgeWeights[i>>2] > 0 ? 10 : 1) : 1;
		N += w;
		m[0]+=r*w;  m[1]+=g*w;  m[2]+=b*w;  m[3]+=a*w;
`
);

code = code.replace(
  /R\[ 0\] \+\= r\*r;  R\[ 1\] \+\= r\*g;[\s\S]*?R\[15\] \+\= a\*a;/m,
  `R[ 0] += r*r*w;  R[ 1] += r*g*w;  R[ 2] += r*b*w;  R[ 3] += r*a*w;  
		               R[ 5] += g*g*w;  R[ 6] += g*b*w;  R[ 7] += g*a*w; 
		                              R[10] += b*b*w;  R[11] += b*a*w;  
		                                             R[15] += a*a*w;`
);

// 4. Implement local Floyd-Steinberg dithering in mapping loop
// Replace:
/*
		var stack = [], si=0;
		for(var i=0; i<len; i+=4) {
			var r=sb[i]*(1/255), g=sb[i+1]*(1/255), b=sb[i+2]*(1/255), a=sb[i+3]*(1/255);
			
			//  exact, but too slow :(
			//var nd = UPNG.quantize.getNearest(root, r, g, b, a);
			var nd = root;
			while(nd.left) nd = (planeDst(nd.est,r,g,b,a)<=0) ? nd.left : nd.right;
			
			tb[i>>2] = nd.est.rgba;
		}
*/

const oldMapLoop = `!`var stack = [], si=0;
		for(var i=0; i<len; i+=4) {
			var r=sb[i]*(1/255), g=sb[i+1]*(1/255), b=sb[i+2]*(1/255), a=sb[i+3]*(1/255);
			
			//  exact, but too slow :(
			//var nd = UPNG.quantize.getNearest(root, r, g, b, a);
			var nd = root;
			while(nd.left) nd = (planeDst(nd.est,r,g,b,a)<=0) ? nd.left : nd.right;
			
			tb[i>>2] = nd.est.rgba;
		}`;

const newMapLoop = `var errors = new Float32Array(len); // store r,g,b,a errors
		var wWidth = w || 0;
		for(var i=0; i<len; i+=4) {
			var px = i>>2;
			var eX = px % wWidth;
			var eY = Math.floor(px / wWidth);
			
			var r=sb[i]*(1/255) + errors[i], g=sb[i+1]*(1/255) + errors[i+1], b=sb[i+2]*(1/255) + errors[i+2], a=sb[i+3]*(1/255) + errors[i+3];
			r = Math.min(1, Math.max(0, r)); g = Math.min(1, Math.max(0, g)); b = Math.min(1, Math.max(0, b)); a = Math.min(1, Math.max(0, a));
			
			var nd = root;
			while(nd.left) nd = (planeDst(nd.est,r,g,b,a)<=0) ? nd.left : nd.right;
			
			tb[px] = nd.est.rgba;
			
			// Local Dithering: Disable if within 3px of text (edgeWeights[px] === 2)
			var ditherIntensity = (!edgeWeights || edgeWeights[px] === 0) ? 1.0 : 0.0;
			
			if (ditherIntensity > 0 && wWidth > 0) {
				var nnR = (nd.est.rgba & 255)/255;
				var nnG = ((nd.est.rgba >> 8) & 255)/255;
				var nnB = ((nd.est.rgba >> 16) & 255)/255;
				var nnA = ((nd.est.rgba >> 24) & 255)/255;
				
				var er = (r - nnR)*ditherIntensity, eg = (g - nnG)*ditherIntensity, eb = (b - nnB)*ditherIntensity, ea = (a - nnA)*ditherIntensity;
				
				var diff = function(dx, dy, f) {
					var nx = eX + dx, ny = eY + dy;
					if (nx < 0 || nx >= wWidth || ny >= h) return;
					var idx = (ny * wWidth + nx) * 4;
					errors[idx]   += er * f;
					errors[idx+1] += eg * f;
					errors[idx+2] += eb * f;
					errors[idx+3] += ea * f;
				};
				diff(1, 0, 7/16);
				diff(-1, 1, 3/16);
				diff(0, 1, 5/16);
				diff(1, 1, 1/16);
			}
		}`;

code = code.replace(oldMapLoop, newMapLoop);

fs.writeFileSync('src/utils/upng.js', code);
console.log('UPNG.js successfully patched!');
